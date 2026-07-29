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
  HttpInputError,
  jsonResponse,
  readBoundedJson,
  statusForCode,
  assertSupportedPublicOrderProtocol,
} from "../_shared/http.ts";
import { issueOrderSessionSchema } from "../_shared/schemas.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { createEdgePerformanceTiming, finalizeEdgeResponse } from "../_shared/performance.ts";

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const timing = createEdgePerformanceTiming({ route: "/functions/v1/create-order-session", requestId });
  let corsHeaders: Record<string, string> = {};
  const respond = (body: unknown, status: number) => finalizeEdgeResponse(
    jsonResponse(body, status, corsHeaders, requestId),
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
    const [ipHash, deviceHash, qrTokenHash, behaviorHash] = await Promise.all([
      hmacHex(abuseSecret, `ip:${clientIp}`),
      hmacHex(abuseSecret, `device:${parsed.data.deviceId}`),
      hmacHex(abuseSecret, `qr:${parsed.data.qrToken}`),
      hmacHex(abuseSecret, `scan:${parsed.data.orderingMode}:${clientIp}:${parsed.data.deviceId}:${parsed.data.qrToken}`),
    ]);

    const admin = createServiceClient();
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

    const { data: resumableOrder, error: resumableOrderError } = await timing.measureDb(() => admin.rpc(
      parsed.data.orderingMode === "DELIVERY"
        ? "lookup_resumable_public_delivery_order"
        : "lookup_resumable_public_order",
      {
        p_qr_token: parsed.data.qrToken,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
        p_qr_token_hash: qrTokenHash,
        p_behavior_hash: behaviorHash,
        p_request_id: requestId,
      },
    ));
    if (resumableOrderError) throw resumableOrderError;
    if (resumableOrder) {
      const recovered = resumableOrder as { order_id: string; order_status: string };
      const { trackingToken } = await derivePublicOrderTokens(
        recovered.order_id,
        requireEnv("TOKEN_DERIVATION_SECRET"),
      );
      return respond({
        resumeOrder: {
          trackingToken,
          orderStatus: recovered.order_status,
        },
      }, 200);
    }

    const sessionToken = await deriveOrderSessionToken(
      parsed.data.sessionRequestId ?? crypto.randomUUID(),
      parsed.data.qrToken,
      parsed.data.deviceId,
      requireEnv("TOKEN_DERIVATION_SECRET"),
    );
    const sessionTokenHash = await sha256Hex(sessionToken);

    const { data: sessionResult, error: sessionError } = await timing.measure(
      "sessionMs",
      () => timing.measureDb(() => admin.rpc("issue_idempotent_order_session_with_schedule", {
        p_qr_token: parsed.data.qrToken,
        p_session_token_hash: sessionTokenHash,
        p_ip_hash: ipHash,
        p_device_hash: deviceHash,
        p_qr_token_hash: qrTokenHash,
        p_behavior_hash: behaviorHash,
        p_request_id: requestId,
        p_ordering_mode: parsed.data.orderingMode,
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

    const [stallQuery, stallProductsQuery, settingsQuery, qrQuery] = await timing.measureDb(() => Promise.all([
      admin.from("stalls")
        .select("organization_id, name, slug, location, currency")
        .eq("id", result.stall_id)
        .single(),
      admin.from("stall_products")
        .select("product_id, price_override, sort_order, available_from, available_until")
        .eq("stall_id", result.stall_id)
        .eq("is_enabled", true)
        .eq("is_sold_out", false)
        .order("sort_order", { ascending: true })
        .limit(100),
      admin.from("stall_ordering_settings")
        .select("max_item_quantity, max_unique_products, max_total_quantity, max_note_length, dine_in_enabled, delivery_module_enabled, enabled_locales, estimated_wait_minutes")
        .eq("stall_id", result.stall_id)
        .single(),
      admin.from("qr_codes")
        .select("dining_table_id")
        .eq("id", result.qr_code_id)
        .single(),
    ]), 4);

    if (stallQuery.error || stallProductsQuery.error || settingsQuery.error || qrQuery.error) {
      throw stallQuery.error ?? stallProductsQuery.error ?? settingsQuery.error ?? qrQuery.error;
    }

    if (
      parsed.data.orderingMode === "DELIVERY"
      && (qrQuery.data.dining_table_id || !settingsQuery.data.delivery_module_enabled)
    ) {
      await timing.measureDb(() => admin.from("order_sessions")
        .update({ status: "REVOKED", revoked_at: new Date().toISOString() })
        .eq("id", result.order_session_id)
        .eq("status", "ACTIVE"));
      throw new HttpInputError("DELIVERY_UNAVAILABLE", 409);
    }

    const tableQuery = qrQuery.data.dining_table_id
      ? await timing.measureDb(() => admin.from("dining_tables")
        .select("id, label, code, is_active")
        .eq("id", qrQuery.data.dining_table_id)
        .eq("stall_id", result.stall_id)
        .single())
      : { data: null, error: null };
    if (tableQuery.error) throw tableQuery.error;
    if (tableQuery.data && (!tableQuery.data.is_active || !settingsQuery.data.dine_in_enabled)) {
      throw new HttpInputError("TABLE_UNAVAILABLE", 409);
    }

    if (!parsed.data.includeMenu) {
      return respond({
        orderSessionToken: sessionToken,
        expiresAt: result.expires_at,
        estimatedWaitMinutes: result.capacity?.quote_max_minutes ?? null,
        estimatedWaitMinMinutes: result.capacity?.quote_min_minutes ?? null,
        estimatedWaitMaxMinutes: result.capacity?.quote_max_minutes ?? null,
        waitAcknowledgmentThresholdMinutes:
          result.capacity?.acknowledgment_threshold_minutes ?? null,
        requiresWaitAcknowledgment: result.capacity?.requires_acknowledgment === true,
      }, result.idempotent_replay ? 200 : 201);
    }

    const lastTableOrderQuery = tableQuery.data
      ? await timing.measureDb(() => admin.from("orders")
        .select("created_at")
        .eq("stall_id", result.stall_id)
        .eq("dining_table_id", tableQuery.data.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle())
      : { data: null, error: null };
    if (lastTableOrderQuery.error) throw lastTableOrderQuery.error;

    const enabledLocales = settingsQuery.data.enabled_locales as string[];

    const now = Date.now();
    const availableAssignments = stallProductsQuery.data.filter((assignment) => (
      (!assignment.available_from || Date.parse(assignment.available_from) <= now)
      && (!assignment.available_until || Date.parse(assignment.available_until) > now)
    ));
    const productIds = availableAssignments.map((assignment) => assignment.product_id);
    const [productsQuery, categoriesQuery, translationsQuery, noteAssignmentsQuery] = await timing.measureDb(() => Promise.all([
      productIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : admin.from("products")
          .select("id, name, description, default_price, image_url, category_id, sort_order")
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
    ]), productIds.length === 0 ? 1 : 4);

    if (productsQuery.error || categoriesQuery.error || translationsQuery.error || noteAssignmentsQuery.error) {
      throw productsQuery.error ?? categoriesQuery.error ?? translationsQuery.error ?? noteAssignmentsQuery.error;
    }

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
    const assignmentsByProductId = new Map(
      availableAssignments.map((assignment) => [assignment.product_id, assignment]),
    );
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
        const assignment = assignmentsByProductId.get(product.id);
        return category && assignment ? [{
          id: product.id,
          name: product.name,
          description: product.description,
          imageUrl: product.image_url,
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
                sortOrder: assignment.sort_order || noteGroup.sort_order,
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
          productSortOrder: assignment.sort_order || product.sort_order,
        }] : [];
      })
      .sort((left, right) => left.categorySortOrder - right.categorySortOrder
        || left.productSortOrder - right.productSortOrder);
    const products = productsWithSortOrder.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      translations: product.translations,
      noteGroups: product.noteGroups,
      price: product.price,
      category: product.category,
    }));

    const settings = settingsQuery.data;
    return respond({
      orderSessionToken: sessionToken,
      expiresAt: result.expires_at,
      stall: {
        name: stallQuery.data.name,
        slug: stallQuery.data.slug,
        location: stallQuery.data.location,
        currency: stallQuery.data.currency,
        fulfillmentType: parsed.data.orderingMode === "DELIVERY"
          ? "DELIVERY"
          : tableQuery.data ? "DINE_IN" : "TAKEOUT",
        table: tableQuery.data ? { id: tableQuery.data.id, code: tableQuery.data.code, label: tableQuery.data.label } : null,
      },
      products,
      supportedLocales: enabledLocales,
      estimatedWaitMinutes: result.capacity?.quote_max_minutes ?? settings.estimated_wait_minutes,
      estimatedWaitMinMinutes:
        result.capacity?.quote_min_minutes ?? settings.estimated_wait_minutes,
      estimatedWaitMaxMinutes:
        result.capacity?.quote_max_minutes ?? settings.estimated_wait_minutes,
      waitAcknowledgmentThresholdMinutes:
        result.capacity?.acknowledgment_threshold_minutes ?? null,
      requiresWaitAcknowledgment: result.capacity?.requires_acknowledgment === true,
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
        detail,
      }));
    }
    return respond({ error: errorMessage(code), code }, status);
  }
});
