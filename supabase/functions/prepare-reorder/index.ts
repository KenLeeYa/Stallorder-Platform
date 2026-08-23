import { getAllowedOrigins } from "../_shared/env.ts";
import {
  errorMessage,
  getCorsHeaders,
  HttpInputError,
  jsonResponse,
  readBoundedJson,
  statusForCode,
} from "../_shared/http.ts";
import { prepareReorderSchema } from "../_shared/schemas.ts";
import { resolveTrackedOrder } from "../_shared/tracked-order.ts";

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  let corsHeaders: Record<string, string> = {};
  const respond = (body: unknown, status: number) => jsonResponse(body, status, corsHeaders, requestId);
  try {
    corsHeaders = getCorsHeaders(request, getAllowedOrigins());
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") throw new HttpInputError("METHOD_NOT_ALLOWED", 405);
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
      throw new HttpInputError("INVALID_REQUEST", 415);
    }
    const parsed = prepareReorderSchema.safeParse(await readBoundedJson(request, 8_000));
    if (!parsed.success) throw new HttpInputError("INVALID_REQUEST", 400);
    const context = await resolveTrackedOrder({
      request,
      requestId,
      trackingToken: parsed.data.trackingToken,
      deviceId: parsed.data.deviceId,
      behavior: "prepare-reorder",
    });
    if (context.order.source !== "QR_MENU" && context.order.source !== "LINE_DELIVERY") {
      throw new HttpInputError("NOT_EDITABLE_SOURCE", 403);
    }
    if (context.order.payment_status !== "UNPAID") {
      throw new HttpInputError("PAYMENT_ALREADY_RECORDED", 409);
    }
    if (Number(context.order.discount_amount) !== 0 || context.order.discount_option_id) {
      throw new HttpInputError("DISCOUNT_ALREADY_APPLIED", 409);
    }
    if (context.order.status !== "WAITING_CONFIRMATION" && context.order.status !== "CONFIRMED") {
      throw new HttpInputError("ORDER_ALREADY_STARTED", 409);
    }

    const [paymentQuery, productionQuery, printQuery] = await Promise.all([
      context.admin.from("payments")
        .select("id")
        .eq("order_id", context.order.id)
        .limit(1),
      context.admin.from("order_production_tasks")
        .select("status")
        .eq("order_id", context.order.id)
        .limit(100),
      context.admin.from("print_jobs")
        .select("status")
        .eq("order_id", context.order.id)
        .limit(100),
    ]);
    if (paymentQuery.error || productionQuery.error || printQuery.error) {
      throw paymentQuery.error ?? productionQuery.error ?? printQuery.error;
    }
    if (paymentQuery.data.length > 0) {
      throw new HttpInputError("PAYMENT_ALREADY_RECORDED", 409);
    }
    if (productionQuery.data.some((task) => task.status !== "PENDING")) {
      throw new HttpInputError("ORDER_ALREADY_STARTED", 409);
    }
    if (printQuery.data.some((job) => job.status !== "PENDING")) {
      throw new HttpInputError("PRINT_ALREADY_STARTED", 409);
    }

    const [itemsQuery, stallQuery, qrQuery] = await Promise.all([
      context.admin.from("order_items")
        .select("id, product_id, name, unit_price, quantity, note, status")
        .eq("order_id", context.order.id)
        .order("created_at", { ascending: true })
        .limit(100),
      context.admin.from("stalls")
        .select("code")
        .eq("id", context.order.stall_id)
        .single(),
      context.admin.from("qr_codes")
        .select("token, dining_table_id, fulfillment_type_context, stall_schedule_id, location_id, market_event_id, token_version, updated_at")
        .eq("stall_id", context.order.stall_id)
        .eq("state", "ACTIVE")
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order("token_version", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(20),
    ]);
    if (itemsQuery.error || stallQuery.error || qrQuery.error) {
      throw itemsQuery.error ?? stallQuery.error ?? qrQuery.error;
    }
    if (itemsQuery.data.some((item) => item.status !== "PENDING")) {
      throw new HttpInputError("ORDER_ALREADY_STARTED", 409);
    }
    const qrCode = selectQrCode(qrQuery.data, context.order.fulfillment_type, context.order.dining_table_id);
    if (!qrCode) throw new HttpInputError("QR_NOT_ACTIVE", 409);

    const itemIds = itemsQuery.data.map((item) => item.id);
    const productIds = [...new Set(itemsQuery.data.flatMap((item) => item.product_id ? [item.product_id] : []))];
    const [notesQuery, assignmentsQuery, productsQuery, noteAssignmentsQuery] = await Promise.all([
      itemIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : context.admin.from("order_item_note_options")
          .select("order_item_id, note_option_id")
          .in("order_item_id", itemIds)
          .limit(5_000),
      productIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : context.admin.from("stall_products")
          .select("product_id, price_override, is_enabled, is_sold_out, available_from, available_until")
          .eq("stall_id", context.order.stall_id)
          .in("product_id", productIds)
          .limit(100),
      productIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : context.admin.from("products")
          .select("id, name, default_price, kind, is_active")
          .eq("organization_id", context.order.organization_id)
          .in("id", productIds)
          .limit(100),
      productIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : context.admin.from("product_note_group_assignments")
          .select("product_id, note_group_id")
          .eq("organization_id", context.order.organization_id)
          .eq("is_active", true)
          .in("product_id", productIds)
          .limit(1_000),
    ]);
    if (notesQuery.error || assignmentsQuery.error || productsQuery.error || noteAssignmentsQuery.error) {
      throw notesQuery.error ?? assignmentsQuery.error ?? productsQuery.error ?? noteAssignmentsQuery.error;
    }
    const groupIds = [...new Set(noteAssignmentsQuery.data.map((assignment) => assignment.note_group_id))];
    const [groupsQuery, optionsQuery] = await Promise.all([
      groupIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : context.admin.from("product_note_groups")
          .select("id, is_required, min_selections")
          .eq("organization_id", context.order.organization_id)
          .eq("is_active", true)
          .in("id", groupIds)
          .limit(500),
      groupIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : context.admin.from("product_note_options")
          .select("id, note_group_id, price_delta")
          .eq("organization_id", context.order.organization_id)
          .eq("is_active", true)
          .in("note_group_id", groupIds)
          .limit(5_000),
    ]);
    if (groupsQuery.error || optionsQuery.error) throw groupsQuery.error ?? optionsQuery.error;

    const result = rebuildItems({
      items: itemsQuery.data,
      historicalNotes: notesQuery.data,
      stallProducts: assignmentsQuery.data,
      products: productsQuery.data,
      noteAssignments: noteAssignmentsQuery.data,
      groups: groupsQuery.data,
      options: optionsQuery.data,
      now: Date.now(),
    });
    const orderingMode = context.order.fulfillment_type === "DELIVERY" ? "DELIVERY" : "PREORDER";
    const view = orderingMode === "DELIVERY" ? "delivery" : "pickup";
    const orderPath = `/store/${encodeURIComponent(stallQuery.data.code)}?view=${view}`;
    return respond({
      qrToken: qrCode.token,
      orderingMode,
      orderPath,
      customerName: context.order.customer_name ?? "",
      customerPhone: context.order.customer_phone ?? "",
      deliveryAddress: context.order.delivery_address ?? "",
      customerNote: context.order.note ?? "",
      scheduledPickupAt: context.order.requested_fulfillment_at
        ?? context.order.scheduled_pickup_at
        ?? "",
      availableItems: result.available,
      unavailableItems: result.unavailable,
    }, 200);
  } catch (error) {
    const code = error instanceof HttpInputError ? error.code : "ORDER_CREATE_ERROR";
    const status = error instanceof HttpInputError ? error.status : statusForCode(code);
    if (!(error instanceof HttpInputError)) {
      console.error(JSON.stringify({ level: "error", event: "PREPARE_REORDER_FAILED", requestId }));
    }
    return respond({ error: errorMessage(code), code }, status);
  }
});

type QrCode = {
  token: string;
  dining_table_id: string | null;
  fulfillment_type_context: string | null;
  stall_schedule_id: string | null;
  location_id: string | null;
  market_event_id: string | null;
};

function selectQrCode(qrCodes: QrCode[], fulfillmentType: string, diningTableId: string | null) {
  const matching = qrCodes.filter((qrCode) => fulfillmentType === "DINE_IN"
    ? qrCode.dining_table_id === diningTableId
    : qrCode.dining_table_id === null && (
      qrCode.fulfillment_type_context === null || qrCode.fulfillment_type_context === fulfillmentType
    ));
  return matching.find((qrCode) => !qrCode.stall_schedule_id && !qrCode.location_id && !qrCode.market_event_id)
    ?? matching[0]
    ?? null;
}

function rebuildItems(input: {
  items: Array<{ id: string; product_id: string | null; name: string; unit_price: number; quantity: number; note: string | null; status: string }>;
  historicalNotes: Array<{ order_item_id: string; note_option_id: string | null }>;
  stallProducts: Array<{ product_id: string; price_override: number | null; is_enabled: boolean; is_sold_out: boolean; available_from: string | null; available_until: string | null }>;
  products: Array<{ id: string; name: string; default_price: number; kind: string; is_active: boolean }>;
  noteAssignments: Array<{ product_id: string; note_group_id: string }>;
  groups: Array<{ id: string; is_required: boolean; min_selections: number }>;
  options: Array<{ id: string; note_group_id: string; price_delta: number }>;
  now: number;
}) {
  const products = new Map(input.products.map((product) => [product.id, product]));
  const stallProducts = new Map(input.stallProducts.map((assignment) => [assignment.product_id, assignment]));
  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const options = new Map(input.options.map((option) => [option.id, option]));
  const assignedGroups = new Map<string, Set<string>>();
  for (const assignment of input.noteAssignments) {
    const set = assignedGroups.get(assignment.product_id) ?? new Set<string>();
    set.add(assignment.note_group_id);
    assignedGroups.set(assignment.product_id, set);
  }
  const notesByItem = new Map<string, string[]>();
  for (const note of input.historicalNotes) {
    if (!note.note_option_id) continue;
    const selected = notesByItem.get(note.order_item_id) ?? [];
    selected.push(note.note_option_id);
    notesByItem.set(note.order_item_id, selected);
  }

  const available: Array<Record<string, unknown>> = [];
  const unavailable: Array<{ name: string; reason: string }> = [];
  for (const item of input.items) {
    const product = item.product_id ? products.get(item.product_id) : null;
    const assignment = item.product_id ? stallProducts.get(item.product_id) : null;
    const isWithinWindow = assignment
      && (!assignment.available_from || Date.parse(assignment.available_from) <= input.now)
      && (!assignment.available_until || Date.parse(assignment.available_until) > input.now);
    if (!item.product_id || !product?.is_active || !assignment?.is_enabled || assignment.is_sold_out || !isWithinWindow) {
      unavailable.push({ name: item.name, reason: assignment?.is_sold_out ? "目前售罄" : "目前無法供應" });
      continue;
    }
    const productGroups = assignedGroups.get(item.product_id) ?? new Set<string>();
    const historicalOptionIds = notesByItem.get(item.id) ?? [];
    const validOptions = historicalOptionIds.flatMap((id) => {
      const option = options.get(id);
      return option && productGroups.has(option.note_group_id) ? [option] : [];
    });
    const selectedByGroup = new Map<string, number>();
    for (const option of validOptions) {
      selectedByGroup.set(option.note_group_id, (selectedByGroup.get(option.note_group_id) ?? 0) + 1);
    }
    const requiredSelectionMissing = [...productGroups].some((groupId) => {
      const group = groups.get(groupId);
      if (!group) return false;
      const minimum = Math.max(group.min_selections, group.is_required ? 1 : 0);
      return (selectedByGroup.get(groupId) ?? 0) < minimum;
    });
    const currentUnitPrice = Math.max(
      0,
      (assignment.price_override ?? product.default_price)
        + validOptions.reduce((total, option) => total + option.price_delta, 0),
    );
    available.push({
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      note: item.note ?? "",
      noteOptionIds: validOptions.map((option) => option.id),
      bundleChoiceIds: [],
      previousUnitPrice: item.unit_price,
      currentUnitPrice,
      priceChanged: currentUnitPrice !== item.unit_price,
      needsReview: product.kind === "BUNDLE"
        || validOptions.length !== historicalOptionIds.length
        || requiredSelectionMissing,
    });
  }
  return { available, unavailable };
}
