import { hmacHex, randomToken, sha256Hex } from "../_shared/crypto.ts";
import { getAllowedOrigins, requireEnv } from "../_shared/env.ts";
import {
  errorMessage,
  getCorsHeaders,
  getGatewayClientIp,
  HttpInputError,
  jsonResponse,
  readBoundedJson,
  statusForCode,
} from "../_shared/http.ts";
import { issueOrderSessionSchema } from "../_shared/schemas.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  let corsHeaders: Record<string, string> = {};

  try {
    corsHeaders = getCorsHeaders(request, getAllowedOrigins());
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") throw new HttpInputError("METHOD_NOT_ALLOWED", 405);

    const parsed = issueOrderSessionSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) throw new HttpInputError("INVALID_REQUEST", 400);

    const abuseSecret = requireEnv("ABUSE_HASH_SECRET");
    const clientIp = getGatewayClientIp(request);
    const sessionToken = randomToken(32);
    const [sessionTokenHash, ipHash, deviceHash, qrTokenHash, behaviorHash] = await Promise.all([
      sha256Hex(sessionToken),
      hmacHex(abuseSecret, `ip:${clientIp}`),
      hmacHex(abuseSecret, `device:${parsed.data.deviceId}`),
      hmacHex(abuseSecret, `qr:${parsed.data.qrToken}`),
      hmacHex(abuseSecret, `scan:${clientIp}:${parsed.data.deviceId}:${parsed.data.qrToken}`),
    ]);

    const admin = createServiceClient();
    const { data: globalGateResult, error: globalGateError } = await admin.rpc(
      "check_global_public_request_gate",
      {
        p_scope: "SESSION",
        p_ip_hash: ipHash,
        p_device_hash: deviceHash,
        p_behavior_hash: behaviorHash,
        p_request_id: requestId,
      },
    );
    if (globalGateError) throw globalGateError;
    const globalGate = globalGateResult as { ok: boolean; code?: string };
    if (!globalGate.ok) {
      const code = globalGate.code ?? "RATE_LIMITED";
      return jsonResponse({ error: errorMessage(code), code }, statusForCode(code), corsHeaders, requestId);
    }

    const { data: sessionResult, error: sessionError } = await admin.rpc("issue_order_session", {
      p_qr_token: parsed.data.qrToken,
      p_session_token_hash: sessionTokenHash,
      p_ip_hash: ipHash,
      p_device_hash: deviceHash,
      p_qr_token_hash: qrTokenHash,
      p_behavior_hash: behaviorHash,
      p_request_id: requestId,
    });
    if (sessionError) throw sessionError;

    const result = sessionResult as { ok: boolean; code?: string; stall_id?: string; qr_code_id?: string; expires_at?: string };
    if (!result.ok || !result.stall_id || !result.qr_code_id || !result.expires_at) {
      const code = result.code ?? "ORDER_CREATE_ERROR";
      return jsonResponse({ error: errorMessage(code), code }, statusForCode(code), corsHeaders, requestId);
    }

    const [stallQuery, stallProductsQuery, settingsQuery, qrQuery] = await Promise.all([
      admin.from("stalls")
        .select("organization_id, name, slug, location, currency")
        .eq("id", result.stall_id)
        .single(),
      admin.from("stall_products")
        .select("product_id, price_override, sort_order")
        .eq("stall_id", result.stall_id)
        .eq("is_enabled", true)
        .eq("is_sold_out", false)
        .order("sort_order", { ascending: true })
        .limit(100),
      admin.from("stall_ordering_settings")
        .select("max_item_quantity, max_unique_products, max_total_quantity, max_note_length, dine_in_enabled")
        .eq("stall_id", result.stall_id)
        .single(),
      admin.from("qr_codes")
        .select("dining_table_id")
        .eq("id", result.qr_code_id)
        .single(),
    ]);

    if (stallQuery.error || stallProductsQuery.error || settingsQuery.error || qrQuery.error) {
      throw stallQuery.error ?? stallProductsQuery.error ?? settingsQuery.error ?? qrQuery.error;
    }

    const tableQuery = qrQuery.data.dining_table_id
      ? await admin.from("dining_tables")
        .select("id, label, code, is_active")
        .eq("id", qrQuery.data.dining_table_id)
        .eq("stall_id", result.stall_id)
        .single()
      : { data: null, error: null };
    if (tableQuery.error) throw tableQuery.error;
    if (tableQuery.data && (!tableQuery.data.is_active || !settingsQuery.data.dine_in_enabled)) {
      throw new HttpInputError("TABLE_UNAVAILABLE", 409);
    }

    const productIds = stallProductsQuery.data.map((assignment) => assignment.product_id);
    const [productsQuery, categoriesQuery, translationsQuery] = await Promise.all([
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
          .limit(500),
    ]);

    if (productsQuery.error || categoriesQuery.error || translationsQuery.error) {
      throw productsQuery.error ?? categoriesQuery.error ?? translationsQuery.error;
    }

    const noteAssignmentsQuery = productIds.length === 0
      ? { data: [], error: null }
      : await admin.from("product_note_group_assignments")
        .select("product_id, note_group_id, sort_order")
        .eq("organization_id", stallQuery.data.organization_id)
        .eq("is_active", true)
        .in("product_id", productIds)
        .order("sort_order", { ascending: true })
        .limit(500);
    if (noteAssignmentsQuery.error) throw noteAssignmentsQuery.error;

    const noteGroupIds = [...new Set(noteAssignmentsQuery.data.map((assignment) => assignment.note_group_id))];
    const [noteGroupsQuery, noteOptionsQuery, noteGroupTranslationsQuery] = await Promise.all([
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
          .limit(500),
    ]);
    if (noteGroupsQuery.error || noteOptionsQuery.error || noteGroupTranslationsQuery.error) {
      throw noteGroupsQuery.error ?? noteOptionsQuery.error ?? noteGroupTranslationsQuery.error;
    }

    const noteOptionIds = noteOptionsQuery.data.map((option) => option.id);
    const noteOptionTranslationsQuery = noteOptionIds.length === 0
      ? { data: [], error: null }
      : await admin.from("product_note_option_translations")
        .select("note_option_id, locale, name")
        .eq("organization_id", stallQuery.data.organization_id)
        .in("note_option_id", noteOptionIds)
        .limit(2_500);
    if (noteOptionTranslationsQuery.error) throw noteOptionTranslationsQuery.error;

    const categoriesById = new Map(categoriesQuery.data.map((category) => [category.id, category]));
    const assignmentsByProductId = new Map(
      stallProductsQuery.data.map((assignment) => [assignment.product_id, assignment]),
    );
    const productsWithSortOrder = productsQuery.data
      .flatMap((product) => {
        const category = categoriesById.get(product.category_id);
        const assignment = assignmentsByProductId.get(product.id);
        return category && assignment ? [{
          id: product.id,
          name: product.name,
          description: product.description,
          imageUrl: product.image_url,
          translations: translationsQuery.data
            .filter((translation) => translation.product_id === product.id)
            .map((translation) => ({ locale: translation.locale, name: translation.name, description: translation.description })),
          noteGroups: noteAssignmentsQuery.data
            .filter((assignment) => assignment.product_id === product.id)
            .flatMap((assignment) => {
              const noteGroup = noteGroupsQuery.data.find((group) => group.id === assignment.note_group_id);
              if (!noteGroup) return [];
              return [{
                id: noteGroup.id,
                name: noteGroup.name,
                selectionMode: noteGroup.selection_mode,
                isRequired: noteGroup.is_required,
                minSelections: noteGroup.min_selections,
                maxSelections: noteGroup.max_selections,
                sortOrder: assignment.sort_order || noteGroup.sort_order,
                translations: noteGroupTranslationsQuery.data
                  .filter((translation) => translation.note_group_id === noteGroup.id)
                  .map((translation) => ({ locale: translation.locale, name: translation.name })),
                options: noteOptionsQuery.data
                  .filter((option) => option.note_group_id === noteGroup.id)
                  .map((option) => ({
                    id: option.id,
                    name: option.name,
                    priceDelta: option.price_delta,
                    sortOrder: option.sort_order,
                    translations: noteOptionTranslationsQuery.data
                      .filter((translation) => translation.note_option_id === option.id)
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
    return jsonResponse({
      orderSessionToken: sessionToken,
      expiresAt: result.expires_at,
      stall: {
        name: stallQuery.data.name,
        slug: stallQuery.data.slug,
        location: stallQuery.data.location,
        currency: stallQuery.data.currency,
        fulfillmentType: tableQuery.data ? "DINE_IN" : "TAKEOUT",
        table: tableQuery.data ? { id: tableQuery.data.id, code: tableQuery.data.code, label: tableQuery.data.label } : null,
      },
      products,
      supportedLocales: [...new Set([
        ...translationsQuery.data.map((translation) => translation.locale),
        ...noteGroupTranslationsQuery.data.map((translation) => translation.locale),
        ...noteOptionTranslationsQuery.data.map((translation) => translation.locale),
      ])].sort(),
      limits: {
        maxItemQuantity: settings.max_item_quantity,
        maxUniqueProducts: settings.max_unique_products,
        maxTotalQuantity: settings.max_total_quantity,
        maxNoteLength: settings.max_note_length,
      },
    }, 201, corsHeaders, requestId);
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
    return jsonResponse({ error: errorMessage(code), code }, status, corsHeaders, requestId);
  }
});
