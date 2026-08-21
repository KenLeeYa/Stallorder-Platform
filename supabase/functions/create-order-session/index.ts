import {
  deriveOrderSessionToken,
  derivePublicOrderTokens,
  hmacHex,
  sha256Hex,
} from "../_shared/crypto.ts";
import { getAllowedOrigins, requireEnv } from "../_shared/env.ts";
import {
  errorMessage,
  getCorsHeaders,
  getGatewayClientIp,
  getPublicOrderOperationId,
  HttpInputError,
  jsonResponse,
  readBoundedJson,
  statusForCode,
  assertSupportedPublicOrderProtocol,
} from "../_shared/http.ts";
import { issueOrderSessionSchema } from "../_shared/schemas.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { createEdgePerformanceTiming, finalizeEdgeResponse } from "../_shared/performance.ts";
import { canonicalPublicOrderTimestamp } from "../_shared/public-order-replay.ts";
import {
  buildPublicOrderResumeResponse,
  buildPublicOrderSessionResponse,
  publicOrderSessionAbuseBehavior,
} from "../_shared/public-order-contract.ts";
import {
  applyBestSellerRanking,
  type BestSellerRankRow,
} from "../_shared/bestseller-ranking.ts";
import {
  filterPublicMenuProductsForTime,
  filterPublicMenuProductsForTimeWindow,
} from "../_shared/public-menu-availability.ts";

function localDateInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ""
  );
  return `${read("year")}-${read("month")}-${read("day")}`;
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const operationId = getPublicOrderOperationId(request);
  const timing = createEdgePerformanceTiming({
    route: "/functions/v1/create-order-session",
    requestId,
    operationId,
  });
  let corsHeaders: Record<string, string> = {};
  const respond = (body: unknown, status: number) => finalizeEdgeResponse(
    jsonResponse(body, status, corsHeaders, requestId, operationId),
    timing,
  );

  try {
    corsHeaders = getCorsHeaders(request, getAllowedOrigins());
    if (request.method === "OPTIONS") {
      return finalizeEdgeResponse(new Response(null, { status: 204, headers: corsHeaders }), timing);
    }
    if (request.method !== "POST") throw new HttpInputError("METHOD_NOT_ALLOWED", 405);
    assertSupportedPublicOrderProtocol(request);

    const parsed = issueOrderSessionSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) throw new HttpInputError("INVALID_REQUEST", 400);

    const abuseSecret = requireEnv("ABUSE_HASH_SECRET");
    const clientIp = getGatewayClientIp(request);
    const admin = createServiceClient();
    const orderingMode = parsed.data.orderingMode;
    const [ipHash, deviceHash, qrTokenHash, behaviorHash] = await Promise.all([
      hmacHex(abuseSecret, `ip:${clientIp}`),
      hmacHex(abuseSecret, `device:${parsed.data.deviceId}`),
      hmacHex(abuseSecret, `qr:${parsed.data.qrToken}`),
      hmacHex(abuseSecret, publicOrderSessionAbuseBehavior({
        orderingMode,
        clientIp,
        deviceId: parsed.data.deviceId,
        qrToken: parsed.data.qrToken,
      })),
    ]);

    const { data: intakeResult, error: intakeError } = await timing.measureDb(() => admin.rpc(
      "check_public_order_intake_availability",
      {
        p_qr_token: parsed.data.qrToken,
        p_device_id: parsed.data.deviceId,
      },
    ));
    if (intakeError) throw intakeError;
    const intake = intakeResult as { ok: boolean; code?: string };
    if (!intake.ok && intake.code === "QR_ORDERING_UNAVAILABLE") {
      const code = intake.code;
      return respond({ error: errorMessage(code), code }, statusForCode(code));
    }

    const { data: globalGateResult, error: globalGateError } = await timing.measureDb(() => admin.rpc(
      "check_global_public_request_gate",
      {
        p_scope: "SESSION",
        p_ip_hash: ipHash,
        p_device_hash: deviceHash,
        p_behavior_hash: behaviorHash,
        p_request_id: requestId,
      },
    ));
    if (globalGateError) throw globalGateError;
    const globalGate = globalGateResult as { ok: boolean; code?: string };
    if (!globalGate.ok) {
      const code = globalGate.code ?? "RATE_LIMITED";
      return respond({ error: errorMessage(code), code }, statusForCode(code));
    }

    const { data: preflightResult, error: preflightError } = await timing.measureDb(() => admin.rpc(
      "public_order_preflight_with_special_closure",
      {
        p_scope: "SESSION",
        p_qr_token: parsed.data.qrToken,
        p_ordering_mode: orderingMode,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
        p_qr_token_hash: qrTokenHash,
        p_behavior_hash: behaviorHash,
        p_request_id: requestId,
        p_session_token_hash: null,
        p_idempotency_key: null,
        p_idempotency_hash: null,
        p_requested_fulfillment_at: null,
        p_lottery_draw_id: null,
        p_items: [],
        p_wait_acknowledged: false,
        p_intake_code: intake.ok ? null : intake.code ?? "QR_ORDERING_UNAVAILABLE",
      },
    ));
    if (preflightError) throw preflightError;
    const preflight = preflightResult as {
      ok: boolean;
      code?: string;
      capacity?: {
        quote_min_minutes?: number;
        quote_max_minutes?: number;
        acknowledgment_threshold_minutes?: number;
        requires_acknowledgment?: boolean;
      };
      resumable_order?: { order_id: string; order_status: string } | null;
      qr_context?: {
        dining_table_id?: string | null;
        fulfillment_type_context?: string | null;
        table?: { id: string; label: string; code: string; is_active: boolean } | null;
        settings?: {
          max_item_quantity: number;
          max_unique_products: number;
          max_total_quantity: number;
          max_note_length: number;
          dine_in_enabled: boolean;
          delivery_module_enabled: boolean;
          takeout_preorder_enabled: boolean;
          enabled_locales: string[];
          estimated_wait_minutes: number;
          lottery_enabled: boolean;
        };
      } | null;
    };
    const resumableOrder = preflight.resumable_order;
    if (resumableOrder) {
      const { trackingToken } = await derivePublicOrderTokens(
        resumableOrder.order_id,
        requireEnv("TOKEN_DERIVATION_SECRET"),
      );
      return respond(buildPublicOrderResumeResponse(
        orderingMode,
        trackingToken,
        resumableOrder.order_status,
      ), 200);
    }
    if (!preflight.ok) {
      const code = preflight.code ?? "QR_ORDERING_UNAVAILABLE";
      return respond({ error: errorMessage(code), code }, statusForCode(code));
    }
    const qrContext = preflight.qr_context;
    const settings = qrContext?.settings;
    if (!qrContext || !settings) throw new Error("PUBLIC_ORDER_PREFLIGHT_CONTEXT_MISSING");

    const sessionToken = await deriveOrderSessionToken(
      parsed.data.sessionRequestId ?? crypto.randomUUID(),
      parsed.data.qrToken,
      parsed.data.deviceId,
      requireEnv("TOKEN_DERIVATION_SECRET"),
    );
    const sessionTokenHash = await sha256Hex(sessionToken);

    const { data: sessionResult, error: sessionError } = await timing.measure(
      "sessionMs",
      () => timing.measureDb(() => admin.rpc("issue_idempotent_order_session_with_schedule_targeted", {
        p_qr_token: parsed.data.qrToken,
        p_session_token_hash: sessionTokenHash,
        p_ip_hash: ipHash,
        p_device_hash: deviceHash,
        p_qr_token_hash: qrTokenHash,
        p_behavior_hash: behaviorHash,
        p_request_id: requestId,
        p_ordering_mode: orderingMode,
      })),
    );
    if (sessionError) throw sessionError;

    const result = sessionResult as {
      ok: boolean;
      code?: string;
      stall_id?: string;
      qr_code_id?: string;
      order_session_id?: string;
      expires_at?: string;
      capacity?: {
        quote_min_minutes?: number;
        quote_max_minutes?: number;
        acknowledgment_threshold_minutes?: number;
        requires_acknowledgment?: boolean;
      };
      idempotent_replay?: boolean;
    };
    if (!result.ok || !result.stall_id || !result.qr_code_id || !result.order_session_id || !result.expires_at) {
      const code = result.code ?? "ORDER_CREATE_ERROR";
      return respond({ error: errorMessage(code), code }, statusForCode(code));
    }

    const fullMenuQueries = parsed.data.includeMenu
      ? await timing.measureDb(() => Promise.all([
        admin.from("stalls")
          .select("organization_id, name, slug, location, currency, timezone")
          .eq("id", result.stall_id)
          .single(),
        admin.from("stall_products")
          .select("product_id, price_override, sort_order, available_from, available_until")
          .eq("stall_id", result.stall_id)
          .eq("is_enabled", true)
          .eq("is_sold_out", false)
          .order("sort_order", { ascending: true })
          .limit(100),
      ]), 2)
      : null;
    if (fullMenuQueries?.[0].error || fullMenuQueries?.[1].error) {
      throw fullMenuQueries[0].error ?? fullMenuQueries[1].error;
    }

    if (!parsed.data.includeMenu) {
      return respond(buildPublicOrderSessionResponse({
        orderSessionToken: sessionToken,
        expiresAt: canonicalPublicOrderTimestamp(result.expires_at),
        orderingMode,
        capacity: result.capacity,
      }), result.idempotent_replay ? 200 : 201);
    }

    const [stallQuery, stallProductsQuery] = fullMenuQueries!;

    const table = qrContext.table;
    const lastTableOrderQuery = table
      ? await timing.measureDb(() => admin.from("orders")
        .select("created_at")
        .eq("stall_id", result.stall_id)
        .eq("dining_table_id", table.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle())
      : { data: null, error: null };
    if (lastTableOrderQuery.error) throw lastTableOrderQuery.error;

    const supportsRequestedFulfillmentTime = !qrContext.dining_table_id
      && qrContext.fulfillment_type_context !== "DINE_IN"
      && (orderingMode === "DELIVERY"
        ? settings.delivery_module_enabled === true
        : settings.takeout_preorder_enabled === true);
    const preorderSlotsQuery = supportsRequestedFulfillmentTime
      ? await timing.measureDb(() => admin.rpc("get_takeout_preorder_slots", {
        p_stall_id: result.stall_id,
      }))
      : { data: [], error: null };
    if (preorderSlotsQuery.error) throw preorderSlotsQuery.error;
    const rawPreorderSlots = Array.isArray(preorderSlotsQuery.data)
      ? preorderSlotsQuery.data.filter((slot): slot is string => typeof slot === "string")
      : [];
    const preorderSlotsWithDates = rawPreorderSlots.flatMap((slot) => {
      const instant = new Date(slot);
      return Number.isNaN(instant.getTime())
        ? []
        : [{ slot, localDate: localDateInTimeZone(instant, stallQuery.data.timezone) }];
    });
    const preorderDates = preorderSlotsWithDates.map(({ localDate }) => localDate).sort();
    const specialClosuresQuery = preorderDates.length === 0
      ? { data: [], error: null }
      : await timing.measureDb(() => admin.from("stall_special_closures")
        .select("starts_on, ends_on")
        .eq("stall_id", result.stall_id)
        .lte("starts_on", preorderDates.at(-1)!)
        .gte("ends_on", preorderDates[0])
        .limit(100));
    if (specialClosuresQuery.error) throw specialClosuresQuery.error;
    const preorderSlots = preorderSlotsWithDates
      .filter(({ localDate }) => !specialClosuresQuery.data.some((closure) => (
        localDate >= closure.starts_on && localDate <= closure.ends_on
      )))
      .map(({ slot }) => slot);

    const enabledLocales = settings.enabled_locales;

    const now = Date.now();
    const productIds = stallProductsQuery.data.map((assignment) => assignment.product_id);
    const [productsQuery, categoriesQuery, groupsQuery, translationsQuery, noteAssignmentsQuery, bestSellerRanksQuery] = await timing.measureDb(() => Promise.all([
      productIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : admin.from("products")
          .select("id, organization_id, name, description, default_price, kind, image_url, category_id, group_id, sort_order")
          .eq("organization_id", stallQuery.data.organization_id)
          .eq("is_active", true)
          .in("id", productIds)
          .limit(100),
      admin.from("product_categories")
        .select("id, name, sort_order")
        .eq("organization_id", stallQuery.data.organization_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .limit(100),
      admin.from("product_groups")
        .select("id, name, sort_order")
        .eq("organization_id", stallQuery.data.organization_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .limit(100),
      productIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : admin.from("product_translations")
          .select("product_id, locale, name, description")
          .eq("organization_id", stallQuery.data.organization_id)
          .in("product_id", productIds)
          .in("locale", enabledLocales)
          .limit(500),
      productIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : admin.from("product_note_group_assignments")
          .select("product_id, note_group_id, sort_order")
          .eq("organization_id", stallQuery.data.organization_id)
          .eq("is_active", true)
          .in("product_id", productIds)
          .order("sort_order", { ascending: true })
          .limit(500),
      admin.rpc("get_stall_best_sellers", { p_stall_id: result.stall_id }),
    ]), productIds.length === 0 ? 3 : 6);

    if (
      productsQuery.error
      || categoriesQuery.error
      || groupsQuery.error
      || translationsQuery.error
      || noteAssignmentsQuery.error
      || bestSellerRanksQuery.error
    ) {
      throw productsQuery.error
        ?? categoriesQuery.error
        ?? groupsQuery.error
        ?? translationsQuery.error
        ?? noteAssignmentsQuery.error
        ?? bestSellerRanksQuery.error;
    }

    const bundleProductIds = productsQuery.data
      .filter((product) => product.kind === "BUNDLE")
      .map((product) => product.id);
    const bundleGroupsQuery = bundleProductIds.length === 0
      ? { data: [], error: null }
      : await timing.measureDb(() => admin.from("product_bundle_choice_groups")
        .select("id, organization_id, bundle_product_id, name, min_selections, max_selections, sort_order")
        .eq("organization_id", stallQuery.data.organization_id)
        .in("bundle_product_id", bundleProductIds)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
        .limit(500));
    if (bundleGroupsQuery.error) throw bundleGroupsQuery.error;

    const bundleGroupIds = bundleGroupsQuery.data.map((group) => group.id);
    const bundleChoicesQuery = bundleGroupIds.length === 0
      ? { data: [], error: null }
      : await timing.measureDb(() => admin.from("product_bundle_choices")
        .select("id, organization_id, choice_group_id, component_product_id, quantity, price_delta, sort_order")
        .eq("organization_id", stallQuery.data.organization_id)
        .eq("is_enabled", true)
        .in("choice_group_id", bundleGroupIds)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .limit(2_000));
    if (bundleChoicesQuery.error) throw bundleChoicesQuery.error;

    const noteGroupIds = [...new Set(noteAssignmentsQuery.data.map((assignment) => assignment.note_group_id))];
    const [noteGroupsQuery, noteOptionsQuery, noteGroupTranslationsQuery] = await timing.measureDb(() => Promise.all([
      noteGroupIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : admin.from("product_note_groups")
          .select("id, name, selection_mode, is_required, min_selections, max_selections, sort_order")
          .eq("organization_id", stallQuery.data.organization_id)
          .eq("is_active", true)
          .in("id", noteGroupIds)
          .order("sort_order", { ascending: true })
          .limit(100),
      noteGroupIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : admin.from("product_note_options")
          .select("id, note_group_id, name, price_delta, sort_order")
          .eq("organization_id", stallQuery.data.organization_id)
          .eq("is_active", true)
          .in("note_group_id", noteGroupIds)
          .order("sort_order", { ascending: true })
          .limit(500),
      noteGroupIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : admin.from("product_note_group_translations")
          .select("note_group_id, locale, name")
          .eq("organization_id", stallQuery.data.organization_id)
          .in("note_group_id", noteGroupIds)
          .in("locale", enabledLocales)
          .limit(500),
    ]), noteGroupIds.length === 0 ? 0 : 3);
    if (noteGroupsQuery.error || noteOptionsQuery.error || noteGroupTranslationsQuery.error) {
      throw noteGroupsQuery.error ?? noteOptionsQuery.error ?? noteGroupTranslationsQuery.error;
    }

    const noteOptionIds = noteOptionsQuery.data.map((option) => option.id);
    const noteOptionTranslationsQuery = noteOptionIds.length === 0
      ? { data: [], error: null }
      : await timing.measureDb(() => admin.from("product_note_option_translations")
        .select("note_option_id, locale, name")
        .eq("organization_id", stallQuery.data.organization_id)
        .in("note_option_id", noteOptionIds)
        .in("locale", enabledLocales)
        .limit(2_500));
    if (noteOptionTranslationsQuery.error) throw noteOptionTranslationsQuery.error;

    const categoriesById = new Map(categoriesQuery.data.map((category) => [category.id, category]));
    const groupsById = new Map(groupsQuery.data.map((group) => [group.id, group]));
    const assignmentsByProductId = new Map(
      stallProductsQuery.data.map((assignment) => [assignment.product_id, assignment]),
    );
    const saleableProductsById = new Map(productsQuery.data
      .filter((product) => categoriesById.has(product.category_id))
      .map((product) => [product.id, product]));
    const bundleGroupsByProductId = new Map<string, typeof bundleGroupsQuery.data>();
    for (const group of bundleGroupsQuery.data) {
      const groups = bundleGroupsByProductId.get(group.bundle_product_id);
      if (groups) groups.push(group);
      else bundleGroupsByProductId.set(group.bundle_product_id, [group]);
    }
    const bundleChoicesByGroupId = new Map<string, typeof bundleChoicesQuery.data>();
    for (const choice of bundleChoicesQuery.data) {
      const choices = bundleChoicesByGroupId.get(choice.choice_group_id);
      if (choices) choices.push(choice);
      else bundleChoicesByGroupId.set(choice.choice_group_id, [choice]);
    }
    const productTranslationsByProductId = new Map<string, typeof translationsQuery.data>();
    for (const translation of translationsQuery.data) {
      const translations = productTranslationsByProductId.get(translation.product_id);
      if (translations) translations.push(translation);
      else productTranslationsByProductId.set(translation.product_id, [translation]);
    }
    const noteAssignmentsByProductId = new Map<string, typeof noteAssignmentsQuery.data>();
    for (const assignment of noteAssignmentsQuery.data) {
      const assignments = noteAssignmentsByProductId.get(assignment.product_id);
      if (assignments) assignments.push(assignment);
      else noteAssignmentsByProductId.set(assignment.product_id, [assignment]);
    }
    const noteGroupsById = new Map(noteGroupsQuery.data.map((group) => [group.id, group]));
    const noteGroupTranslationsByGroupId = new Map<string, typeof noteGroupTranslationsQuery.data>();
    for (const translation of noteGroupTranslationsQuery.data) {
      const translations = noteGroupTranslationsByGroupId.get(translation.note_group_id);
      if (translations) translations.push(translation);
      else noteGroupTranslationsByGroupId.set(translation.note_group_id, [translation]);
    }
    const noteOptionsByGroupId = new Map<string, typeof noteOptionsQuery.data>();
    for (const option of noteOptionsQuery.data) {
      const options = noteOptionsByGroupId.get(option.note_group_id);
      if (options) options.push(option);
      else noteOptionsByGroupId.set(option.note_group_id, [option]);
    }
    const noteOptionTranslationsByOptionId = new Map<string, typeof noteOptionTranslationsQuery.data>();
    for (const translation of noteOptionTranslationsQuery.data) {
      const translations = noteOptionTranslationsByOptionId.get(translation.note_option_id);
      if (translations) translations.push(translation);
      else noteOptionTranslationsByOptionId.set(translation.note_option_id, [translation]);
    }
    const productsWithSortOrder = productsQuery.data
      .flatMap((product) => {
        const category = categoriesById.get(product.category_id);
        const group = product.group_id ? groupsById.get(product.group_id) : null;
        const assignment = assignmentsByProductId.get(product.id);
        const bundleChoiceGroups = product.kind === "BUNDLE"
          ? (bundleGroupsByProductId.get(product.id) ?? []).map((group) => ({
            id: group.id,
            organizationId: group.organization_id,
            name: group.name,
            minSelections: group.min_selections,
            maxSelections: group.max_selections,
            sortOrder: group.sort_order,
            options: (bundleChoicesByGroupId.get(group.id) ?? []).flatMap((choice) => {
              const component = saleableProductsById.get(choice.component_product_id);
              const componentAssignment = assignmentsByProductId.get(choice.component_product_id);
              return choice.organization_id === product.organization_id
                && component?.organization_id === product.organization_id
                && component.kind === "SINGLE"
                && componentAssignment
                ? [{
                  id: choice.id,
                  componentProductId: component.id,
                  componentProductName: component.name,
                  quantity: choice.quantity,
                  priceDelta: choice.price_delta,
                  sortOrder: choice.sort_order,
                  availableFrom: componentAssignment.available_from,
                  availableUntil: componentAssignment.available_until,
                }]
                : [];
            }),
          }))
          : [];
        const bundleIsComplete = product.kind !== "BUNDLE" || (
          bundleChoiceGroups.length > 0
          && bundleChoiceGroups.every((group) => (
            group.organizationId === product.organization_id
            && group.options.length >= Math.max(1, group.minSelections)
          ))
        );
        return category && assignment && bundleIsComplete && (!product.group_id || group) ? [{
          id: product.id,
          name: product.name,
          description: product.description,
          imageUrl: product.image_url,
          availableFrom: assignment.available_from,
          availableUntil: assignment.available_until,
          kind: product.kind,
          bundleChoiceGroups: bundleChoiceGroups.map((group) => ({
            id: group.id,
            name: group.name,
            minSelections: group.minSelections,
            maxSelections: group.maxSelections,
            sortOrder: group.sortOrder,
            options: group.options,
          })),
          translations: (productTranslationsByProductId.get(product.id) ?? [])
            .map((translation) => ({ locale: translation.locale, name: translation.name, description: translation.description })),
          noteGroups: (noteAssignmentsByProductId.get(product.id) ?? [])
            .flatMap((assignment) => {
              const noteGroup = noteGroupsById.get(assignment.note_group_id);
              if (!noteGroup) return [];
              return [{
                id: noteGroup.id,
                name: noteGroup.name,
                selectionMode: noteGroup.selection_mode,
                isRequired: noteGroup.is_required,
                minSelections: noteGroup.min_selections,
                maxSelections: noteGroup.max_selections,
                sortOrder: assignment.sort_order,
                translations: (noteGroupTranslationsByGroupId.get(noteGroup.id) ?? [])
                  .map((translation) => ({ locale: translation.locale, name: translation.name })),
                options: (noteOptionsByGroupId.get(noteGroup.id) ?? [])
                  .map((option) => ({
                    id: option.id,
                    name: option.name,
                    priceDelta: option.price_delta,
                    sortOrder: option.sort_order,
                    translations: (noteOptionTranslationsByOptionId.get(option.id) ?? [])
                      .map((translation) => ({ locale: translation.locale, name: translation.name })),
                  })),
              }];
            })
            .sort((left, right) => left.sortOrder - right.sortOrder),
          price: assignment.price_override ?? product.default_price,
          category: category.name,
          categorySortOrder: category.sort_order,
          group: group?.name ?? null,
          groupSortOrder: group?.sort_order ?? 10_001,
          productSortOrder: assignment.sort_order,
        }] : [];
      })
      .sort((left, right) => left.categorySortOrder - right.categorySortOrder
        || left.groupSortOrder - right.groupSortOrder
        || left.productSortOrder - right.productSortOrder);
    const rankedProducts = applyBestSellerRanking(productsWithSortOrder.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      availableFrom: product.availableFrom,
      availableUntil: product.availableUntil,
      translations: product.translations,
      kind: product.kind,
      bundleChoiceGroups: product.bundleChoiceGroups,
      noteGroups: product.noteGroups,
      price: product.price,
      category: product.category,
      group: product.group,
    })), (bestSellerRanksQuery.data ?? []) as BestSellerRankRow[]);
    const products = orderingMode === "PREORDER"
      ? filterPublicMenuProductsForTimeWindow(rankedProducts, preorderSlots)
      : filterPublicMenuProductsForTime(rankedProducts, now);

    return respond({
      ...buildPublicOrderSessionResponse({
        orderSessionToken: sessionToken,
        expiresAt: canonicalPublicOrderTimestamp(result.expires_at),
        orderingMode,
        capacity: result.capacity,
        fallbackWaitMinutes: settings.estimated_wait_minutes,
      }),
      stall: {
        name: stallQuery.data.name,
        slug: stallQuery.data.slug,
        location: stallQuery.data.location,
        currency: stallQuery.data.currency,
        timezone: stallQuery.data.timezone,
        fulfillmentType: orderingMode === "DELIVERY"
          ? "DELIVERY"
          : table ? "DINE_IN" : "TAKEOUT",
        table: table ? { id: table.id, code: table.code, label: table.label } : null,
      },
      products,
      preorderSlots,
      lotteryEnabled: orderingMode === "DEFAULT" && settings.lottery_enabled === true,
      supportedLocales: enabledLocales,
      lastTableOrderAt: lastTableOrderQuery.data?.created_at ?? null,
      limits: {
        maxItemQuantity: settings.max_item_quantity,
        maxUniqueProducts: settings.max_unique_products,
        maxTotalQuantity: settings.max_total_quantity,
        maxNoteLength: settings.max_note_length,
      },
    }, result.idempotent_replay ? 200 : 201);
  } catch (error) {
    const code = error instanceof HttpInputError ? error.code : "ORDER_CREATE_ERROR";
    const status = error instanceof HttpInputError ? error.status : 500;
    if (!(error instanceof HttpInputError)) {
      const detail = error && typeof error === "object" && "message" in error
        ? String(error.message).replace(/[\r\n]/g, " ").slice(0, 300)
        : "unknown";
      console.error(JSON.stringify({
        level: "error",
        event: "ORDER_SESSION_EDGE_FAILED",
        requestId,
        operationId,
        detail,
      }));
    }
    return respond({ error: errorMessage(code), code }, status);
  }
});
