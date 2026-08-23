"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PaymentOptionKind, UserRole } from "@prisma/client";
import { ArchiveRestore, ChevronDown, List, Minus, Package, Plus, Save, Send, ShoppingCart, Trash2, Truck, Utensils, X } from "lucide-react";
import { FulfillmentTimePicker } from "@/components/fulfillment-time-picker";
import { useOperationsLocale } from "@/components/operations-locale";
import { StaffDiscountSelector } from "@/components/staff-discount-selector";
import { csrfHeaders } from "@/lib/csrf-client";
import { calculateOrderDiscount } from "@/lib/checkout";
import { formatMoney } from "@/lib/money";
import { formatAppDateTime } from "@/lib/locale-format";
import { getOperationsErrorMessage } from "@/lib/messages/operations";
import { PHONE_INPUT_PATTERN } from "@/lib/phone-input-pattern";
import { notePriceAdjustment, noteSelectionIsValid, toggleNoteOption } from "@/lib/product-note-selection";
import {
  addQrCartLine,
  QR_CART_TTL_MS,
  qrCartProductQuantity,
  qrCartTotalQuantity,
  replaceQrCartLine,
  restoreQrCartDraft,
  serializeQrCartDraft,
  updateQrCartLineQuantity,
  type QrCartLine,
} from "@/lib/qr-cart";
import { hasPermission } from "@/lib/rbac";
import type { AppLocale } from "@/lib/app-locale";
import type { StaffOrderDto } from "@/lib/orders";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";
import { buildFulfillmentTimeSlots } from "@/lib/fulfillment-time-options";
import { createWebUuid } from "@/lib/web-uuid";

const PHONE_NUMBER = /^\+?[0-9][0-9 ().-]{5,29}$/;
const STAFF_ORDER_DRAFT_VERSION = 2;
const STAFF_ORDER_DRAFT_LIMIT = 5;
const STAFF_ORDER_DRAFT_MAX_BYTES = 250_000;

type StaffOrderDraft = {
  version: typeof STAFF_ORDER_DRAFT_VERSION;
  id: string;
  savedAt: number;
  label: string;
  itemCount: number;
  cartDraft: string;
  fulfillmentType: "TAKEOUT" | "DINE_IN" | "DELIVERY";
  diningTableId: string;
  requestedFulfillmentAt: string;
  paymentTiming: "PAY_NOW" | "PAY_LATER";
  paymentOptionId: string | null;
  discountOptionId: string | null;
  discountApprovalReason: string;
};

type Props = {
  stall: { id: string; organizationId: string; slug: string; currency: string; timezone?: string };
  catalog: StaffOrderCatalog;
  account: { role: UserRole };
  modules: { dineIn: boolean; delivery: boolean; print: boolean; payment: boolean; discount: boolean; discountApprovalThresholdBps: number };
  paymentOptions: Array<{ id: string; name: string; kind: PaymentOptionKind }>;
  discountOptions: Array<{ id: string; name: string; rateBps: number }>;
  discountSettingsHref?: string;
  onCreated: (order: StaffOrderDto) => void;
  onClose: () => void;
};

export function StaffOrderComposer({
  stall,
  catalog,
  account,
  modules,
  paymentOptions,
  discountOptions,
  discountSettingsHref,
  onCreated,
  onClose,
}: Props) {
  const { locale, t } = useOperationsLocale();
  const optionSeparator = locale === "zh-TW" || locale === "ja" ? "、" : ", ";
  const idempotencyKeyRef = useRef(createWebUuid());
  const menuScrollRef = useRef<HTMLDivElement>(null);
  const cartScrollRef = useRef<HTMLElement>(null);
  const defaultPayment = modules.payment
    ? paymentOptions[0] ?? null
    : paymentOptions.find((option) => option.kind === "CASH") ?? null;
  const [fulfillmentType, setFulfillmentType] = useState<"TAKEOUT" | "DINE_IN" | "DELIVERY">("TAKEOUT");
  const [diningTableId, setDiningTableId] = useState(catalog.tables[0]?.id ?? "");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [requestedFulfillmentAt, setRequestedFulfillmentAt] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [cartLines, setCartLines] = useState<QrCartLine[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [noteSelections, setNoteSelections] = useState<Record<string, string[]>>({});
  const [bundleSelections, setBundleSelections] = useState<Record<string, string[]>>({});
  const [editingLineIds, setEditingLineIds] = useState<Record<string, string>>({});
  const [paymentTiming, setPaymentTiming] = useState<"PAY_NOW" | "PAY_LATER">("PAY_NOW");
  const [paymentOptionId, setPaymentOptionId] = useState(defaultPayment?.id ?? null);
  const [discountOptionId, setDiscountOptionId] = useState<string | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  const [discountApprovalReason, setDiscountApprovalReason] = useState("");
  const [managerAuthorizationCode, setManagerAuthorizationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [activePane, setActivePane] = useState<"MENU" | "CART">("MENU");
  const [catalogExpanded, setCatalogExpanded] = useState(true);
  const [collapsedCatalogSections, setCollapsedCatalogSections] = useState<Set<string>>(() => new Set());
  const [savedDrafts, setSavedDrafts] = useState<StaffOrderDraft[]>([]);
  const [draftManagerOpen, setDraftManagerOpen] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const draftStorageKey = staffOrderDraftStorageKey(stall.organizationId, stall.id);

  const productsById = useMemo(
    () => new Map(catalog.products.map((product) => [product.id, product])),
    [catalog.products],
  );
  const restorableProducts = useMemo(() => catalog.products.map((product) => ({
    id: product.id,
    noteGroups: product.noteGroups,
    bundleChoiceGroups: (product.bundleChoiceGroups ?? []).map((group) => ({
      options: group.choices,
    })),
  })), [catalog.products]);
  const selectedItems = useMemo(() => cartLines.flatMap((line) => {
    const product = productsById.get(line.productId);
    return product ? [{
      cartLineId: line.id,
      product,
      quantity: line.quantity,
      noteOptionIds: line.noteOptionIds,
      bundleChoiceIds: line.bundleChoiceIds,
    }] : [];
  }), [cartLines, productsById]);
  const cartQuantitiesByProduct = useMemo(() => {
    const quantitiesByProduct = new Map<string, number>();
    for (const line of cartLines) {
      quantitiesByProduct.set(
        line.productId,
        (quantitiesByProduct.get(line.productId) ?? 0) + line.quantity,
      );
    }
    return quantitiesByProduct;
  }, [cartLines]);
  const totalQuantity = qrCartTotalQuantity(cartLines);
  const subtotal = selectedItems.reduce((sum, item) => (
    sum + Math.max(
      0,
      item.product.price
        + bundlePriceAdjustment(item.product, item.bundleChoiceIds)
        + notePriceAdjustment(item.product.noteGroups, item.noteOptionIds),
    ) * item.quantity
  ), 0);
  const discountEligibleSubtotal = selectedItems.reduce((sum, item) => {
    if (!item.product.isOrderDiscountEligible) return sum;
    return sum + Math.max(
      0,
      item.product.price
        + bundlePriceAdjustment(item.product, item.bundleChoiceIds)
        + notePriceAdjustment(item.product.noteGroups, item.noteOptionIds),
    ) * item.quantity;
  }, 0);
  const applicableDiscountOptionId = discountEligibleSubtotal > 0 ? discountOptionId : null;
  const discount = discountOptions.find((option) => option.id === applicableDiscountOptionId) ?? null;
  const total = calculateOrderDiscount(
    subtotal,
    discountEligibleSubtotal,
    discount?.rateBps ?? 10_000,
  ).total;
  const payment = paymentOptions.find((option) => option.id === paymentOptionId) ?? null;
  const usesCash = !modules.payment || payment?.kind === "CASH";
  const received = cashReceived === "" ? total : Number(cashReceived);
  const change = usesCash && Number.isFinite(received) ? Math.max(0, received - total) : 0;
  const needsApproval = Boolean(
    discount
    && discountEligibleSubtotal > 0
    && discount.rateBps < modules.discountApprovalThresholdBps,
  );
  const operatorCanApprove = hasPermission(account.role, "APPROVE_DISCOUNT");
  const catalogSections = buildStaffCatalogSections(catalog.products, locale);
  const catalogNavigationItems = catalogSections.map((section, index) => ({
    ...section,
    id: `staff-catalog-section-${index}`,
  }));
  const tableGroups = useMemo(() => {
    const groups = new Map<string, StaffOrderCatalog["tables"]>();
    for (const table of catalog.tables) {
      groups.set(table.floorName, [...(groups.get(table.floorName) ?? []), table]);
    }
    return [...groups.entries()];
  }, [catalog.tables]);
  const fulfillmentTimeSlots = useMemo(
    () => buildFulfillmentTimeSlots(catalog.fulfillmentSlots, stall.timezone ?? "Asia/Taipei"),
    [catalog.fulfillmentSlots, stall.timezone],
  );
  const [activeCatalogAnchor, setActiveCatalogAnchor] = useState(catalogNavigationItems[0]?.id ?? "");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const drafts = parseStaffOrderDrafts(window.localStorage.getItem(draftStorageKey));
        setSavedDrafts(drafts);
        window.localStorage.setItem(draftStorageKey, JSON.stringify(drafts));
      } catch {
        setDraftNotice(t("composer.draft.unavailable"));
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draftStorageKey, t]);

  function switchPane(pane: "MENU" | "CART") {
    setActivePane(pane);
    (pane === "MENU" ? menuScrollRef.current : cartScrollRef.current)?.scrollTo({ top: 0 });
  }

  function scrollToCatalogTarget(target: (typeof catalogNavigationItems)[number]) {
    setActiveCatalogAnchor(target.id);
    expandCatalogSection(target.key);
    window.requestAnimationFrame(() => {
      document.getElementById(target.id)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function expandCatalogSection(sectionKey: string) {
    setCollapsedCatalogSections((current) => {
      if (!current.has(sectionKey)) return current;
      const next = new Set(current);
      next.delete(sectionKey);
      return next;
    });
  }

  function toggleCatalogSection(sectionKey: string) {
    setCollapsedCatalogSections((current) => {
      const next = new Set(current);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }

  function toggleCatalog() {
    if (catalogExpanded) {
      setCatalogExpanded(false);
      return;
    }
    setCollapsedCatalogSections(new Set());
    setCatalogExpanded(true);
  }

  function persistDrafts(nextDrafts: StaffOrderDraft[]) {
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(nextDrafts));
      setSavedDrafts(nextDrafts);
      return true;
    } catch {
      setDraftNotice(t("composer.draft.unavailable"));
      return false;
    }
  }

  function resetCurrentOrder() {
    idempotencyKeyRef.current = createWebUuid();
    setFulfillmentType("TAKEOUT");
    setDiningTableId(catalog.tables[0]?.id ?? "");
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
    setRequestedFulfillmentAt("");
    setCustomerNote("");
    setCartLines([]);
    setQuantities({});
    setNoteSelections({});
    setBundleSelections({});
    setEditingLineIds({});
    setPaymentTiming("PAY_NOW");
    setPaymentOptionId(defaultPayment?.id ?? null);
    setDiscountOptionId(null);
    setCashReceived("");
    setDiscountApprovalReason("");
    setManagerAuthorizationCode("");
    setMessage("");
    setActivePane("MENU");
    setCatalogExpanded(true);
    setCollapsedCatalogSections(new Set());
    setActiveCatalogAnchor(catalogNavigationItems[0]?.id ?? "");
    setActiveDraftId(null);
    menuScrollRef.current?.scrollTo({ top: 0 });
  }

  function saveCurrentDraft() {
    if (cartLines.length === 0) {
      setDraftNotice(Object.values(quantities).some((quantity) => quantity > 0)
        ? t("composer.draft.pendingItem")
        : t("composer.draft.noItems"));
      return;
    }
    const previous = activeDraftId
      ? savedDrafts.find((draft) => draft.id === activeDraftId)
      : null;
    if (!previous && savedDrafts.length >= STAFF_ORDER_DRAFT_LIMIT) {
      setDraftNotice(t("composer.draft.limit", { limit: STAFF_ORDER_DRAFT_LIMIT }));
      setDraftManagerOpen(true);
      return;
    }
    const cartDraft = serializeQrCartDraft({
      orderingMode: "DEFAULT",
      scheduledPickupAt: "",
      customerName: "",
      customerNote: "",
      customerPhone: "",
      deliveryAddress: "",
      lines: cartLines.map((line) => ({ ...line, note: "" })),
    });
    if (cartDraft.length > STAFF_ORDER_DRAFT_MAX_BYTES) {
      setDraftNotice(t("composer.draft.tooLarge"));
      return;
    }
    const draft: StaffOrderDraft = {
      version: STAFF_ORDER_DRAFT_VERSION,
      id: previous?.id ?? createWebUuid(),
      savedAt: savedAtFromQrCartDraft(cartDraft),
      label: t("composer.draft.defaultLabel", {
        fulfillment: fulfillmentType === "DINE_IN" ? t("composer.dineIn") : fulfillmentType === "DELIVERY" ? t("composer.delivery") : t("composer.takeout"),
        count: totalQuantity,
      }),
      itemCount: totalQuantity,
      cartDraft,
      fulfillmentType,
      diningTableId,
      requestedFulfillmentAt,
      paymentTiming,
      paymentOptionId,
      discountOptionId: applicableDiscountOptionId,
      discountApprovalReason: "",
    };
    const nextDrafts = [draft, ...savedDrafts.filter((candidate) => candidate.id !== draft.id)]
      .sort((left, right) => right.savedAt - left.savedAt)
      .slice(0, STAFF_ORDER_DRAFT_LIMIT);
    if (!persistDrafts(nextDrafts)) return;
    resetCurrentOrder();
    setDraftNotice(t("composer.draft.saved", { label: draft.label }));
  }

  function restoreSavedDraft(draft: StaffOrderDraft) {
    const hasCurrentInput = cartLines.length > 0
      || Object.values(quantities).some((quantity) => quantity > 0)
      || customerName.trim().length > 0
      || customerPhone.trim().length > 0
      || deliveryAddress.trim().length > 0
      || customerNote.trim().length > 0;
    if (hasCurrentInput && !window.confirm(t("composer.draft.replaceConfirm"))) return;
    const restored = restoreQrCartDraft(
      draft.cartDraft,
      restorableProducts,
      catalog.limits,
      undefined,
      { orderingMode: "DEFAULT" },
    );
    if (!restored || restored.lines.length === 0) {
      setDraftNotice(t("composer.draft.invalid"));
      return;
    }
    const fulfillmentAvailable = draft.fulfillmentType === "TAKEOUT"
      || (draft.fulfillmentType === "DELIVERY" && modules.delivery)
      || (draft.fulfillmentType === "DINE_IN" && modules.dineIn && catalog.tables.length > 0);
    const nextFulfillmentType = fulfillmentAvailable ? draft.fulfillmentType : "TAKEOUT";
    const nextDiningTableId = nextFulfillmentType === "DINE_IN"
      && catalog.tables.some((table) => table.id === draft.diningTableId)
      ? draft.diningTableId
      : catalog.tables[0]?.id ?? "";
    const nextRequestedFulfillmentAt = nextFulfillmentType !== "DINE_IN"
      && fulfillmentTimeSlots.some((slot) => slot.iso === draft.requestedFulfillmentAt)
      ? draft.requestedFulfillmentAt
      : "";
    const nextPaymentOptionId = draft.paymentOptionId
      && paymentOptions.some((option) => option.id === draft.paymentOptionId)
      ? draft.paymentOptionId
      : defaultPayment?.id ?? null;
    const nextDiscountOptionId = draft.discountOptionId
      && discountOptions.some((option) => option.id === draft.discountOptionId)
      ? draft.discountOptionId
      : null;

    idempotencyKeyRef.current = createWebUuid();
    setFulfillmentType(nextFulfillmentType);
    setDiningTableId(nextDiningTableId);
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
    setRequestedFulfillmentAt(nextRequestedFulfillmentAt);
    setCustomerNote("");
    setCartLines(restored.lines.map((line) => ({ ...line, note: "" })));
    setQuantities({});
    setNoteSelections({});
    setBundleSelections({});
    setEditingLineIds({});
    setPaymentTiming(draft.paymentTiming);
    setPaymentOptionId(nextPaymentOptionId);
    setDiscountOptionId(nextDiscountOptionId);
    setCashReceived("");
    setDiscountApprovalReason("");
    setManagerAuthorizationCode("");
    setMessage("");
    setCatalogExpanded(true);
    setCollapsedCatalogSections(new Set());
    setActiveCatalogAnchor(catalogNavigationItems[0]?.id ?? "");
    setActivePane("MENU");
    setActiveDraftId(draft.id);
    setDraftManagerOpen(false);
    setDraftNotice([
      t("composer.draft.restored", { label: draft.label }),
      fulfillmentAvailable ? "" : t("composer.draft.fulfillmentChanged"),
      draft.requestedFulfillmentAt && !nextRequestedFulfillmentAt ? t("composer.draft.timeExpired") : "",
      t("composer.draft.secureFields"),
    ].filter(Boolean).join(" "));
    window.requestAnimationFrame(() => menuScrollRef.current?.scrollTo({ top: 0 }));
  }

  function deleteSavedDraft(draft: StaffOrderDraft) {
    if (!window.confirm(t("composer.draft.deleteConfirm", { label: draft.label }))) return;
    const nextDrafts = savedDrafts.filter((candidate) => candidate.id !== draft.id);
    if (!persistDrafts(nextDrafts)) return;
    if (activeDraftId === draft.id) setActiveDraftId(null);
    setDraftNotice(t("composer.draft.deleted", { label: draft.label }));
  }

  function consumeActiveDraft() {
    if (!activeDraftId) return;
    const nextDrafts = savedDrafts.filter((draft) => draft.id !== activeDraftId);
    persistDrafts(nextDrafts);
    setActiveDraftId(null);
  }

  function selectFulfillmentType(next: "TAKEOUT" | "DINE_IN" | "DELIVERY") {
    setFulfillmentType(next);
    if (next !== fulfillmentType) {
      setRequestedFulfillmentAt("");
    }
  }

  function setQuantity(productId: string, nextQuantity: number) {
    const next = Math.max(0, nextQuantity);
    const editingLineId = editingLineIds[productId];
    const effectiveLines = editingLineId
      ? cartLines.filter((line) => line.id !== editingLineId)
      : cartLines;
    const distinctProducts = new Set(effectiveLines.map((line) => line.productId));
    const nextUnique = distinctProducts.size + (
      next > 0 && !distinctProducts.has(productId) ? 1 : 0
    );
    if (
      qrCartProductQuantity(effectiveLines, productId) + next > catalog.limits.maxItemQuantity
      || qrCartTotalQuantity(effectiveLines) + next > catalog.limits.maxTotalQuantity
      || nextUnique > catalog.limits.maxUniqueProducts
    ) {
      setMessage(t("composer.itemLimit"));
      return;
    }
    setMessage("");
    setQuantities((currentQuantities) => ({
      ...currentQuantities,
      [productId]: next,
    }));
    if (next <= 0) {
      setNoteSelections((currentSelections) => {
        const nextSelections = { ...currentSelections };
        delete nextSelections[productId];
        return nextSelections;
      });
      setBundleSelections((currentSelections) => {
        const nextSelections = { ...currentSelections };
        delete nextSelections[productId];
        return nextSelections;
      });
    }
  }

  function addProductToCart(product: StaffCatalogProduct) {
    const quantity = quantities[product.id] ?? 0;
    if (quantity <= 0) return;
    const noteOptionIds = noteSelections[product.id] ?? [];
    const bundleChoiceIds = bundleSelections[product.id] ?? [];
    if (!noteSelectionIsValid(product.noteGroups, noteOptionIds)) {
      setMessage(t("composer.requiredNotes", { item: localizedStaffProduct(product, locale).name }));
      return;
    }
    if (!bundleSelectionIsValid(product, bundleChoiceIds)) {
      setMessage(t("composer.requiredBundle", { item: localizedStaffProduct(product, locale).name }));
      return;
    }
    const editingLineId = editingLineIds[product.id];
    const nextLine = {
      productId: product.id,
      quantity,
      note: "",
      noteOptionIds,
      bundleChoiceIds,
    };
    const nextLines = editingLineId
      ? replaceQrCartLine(cartLines, editingLineId, nextLine, catalog.limits)
      : addQrCartLine(cartLines, nextLine, catalog.limits, createWebUuid);
    if (!nextLines) {
      setMessage(t("composer.itemLimit"));
      return;
    }
    setCartLines(nextLines);
    setQuantities((current) => {
      const nextQuantities = { ...current };
      delete nextQuantities[product.id];
      return nextQuantities;
    });
    setNoteSelections((current) => {
      const nextSelections = { ...current };
      delete nextSelections[product.id];
      return nextSelections;
    });
    setBundleSelections((current) => {
      const nextSelections = { ...current };
      delete nextSelections[product.id];
      return nextSelections;
    });
    setEditingLineIds((current) => {
      const nextLineIds = { ...current };
      delete nextLineIds[product.id];
      return nextLineIds;
    });
    setMessage("");
  }

  function changeCartLineQuantity(lineId: string, quantity: number) {
    const nextLines = updateQrCartLineQuantity(cartLines, lineId, quantity, catalog.limits);
    if (!nextLines) {
      setMessage(t("composer.itemLimit"));
      return;
    }
    setCartLines(nextLines);
    const changedLine = cartLines.find((line) => line.id === lineId);
    if (changedLine && editingLineIds[changedLine.productId] === lineId) {
      if (quantity <= 0) {
        setQuantities((current) => {
          const nextQuantities = { ...current };
          delete nextQuantities[changedLine.productId];
          return nextQuantities;
        });
        setNoteSelections((current) => {
          const nextSelections = { ...current };
          delete nextSelections[changedLine.productId];
          return nextSelections;
        });
        setBundleSelections((current) => {
          const nextSelections = { ...current };
          delete nextSelections[changedLine.productId];
          return nextSelections;
        });
        setEditingLineIds((current) => {
          const nextLineIds = { ...current };
          delete nextLineIds[changedLine.productId];
          return nextLineIds;
        });
      } else {
        setQuantities((current) => current[changedLine.productId] === undefined
          ? current
          : { ...current, [changedLine.productId]: quantity });
      }
    }
    setMessage("");
  }

  function editCartLine(line: QrCartLine) {
    const product = productsById.get(line.productId);
    if (!product || (product.noteGroups.length === 0 && (product.bundleChoiceGroups?.length ?? 0) === 0)) return;
    setQuantities((current) => ({ ...current, [line.productId]: line.quantity }));
    setNoteSelections((current) => ({ ...current, [line.productId]: line.noteOptionIds }));
    setBundleSelections((current) => ({ ...current, [line.productId]: line.bundleChoiceIds }));
    setEditingLineIds((current) => ({ ...current, [line.productId]: line.id }));
    setCatalogExpanded(true);
    const productSection = catalogNavigationItems.find((item) => (
      item.products.some((candidate) => candidate.id === product.id)
    ));
    if (productSection) expandCatalogSection(productSection.key);
    setActiveCatalogAnchor(productSection?.id ?? catalogNavigationItems[0]?.id ?? "");
    switchPane("MENU");
    window.setTimeout(() => document.getElementById(`staff-product-${line.productId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    }), 0);
  }

  function selectNoteOption(
    productId: string,
    group: StaffOrderCatalog["products"][number]["noteGroups"][number],
    optionId: string | null,
  ) {
    setNoteSelections((current) => ({
      ...current,
      [productId]: toggleNoteOption(current[productId] ?? [], group, optionId),
    }));
  }

  function selectBundleChoice(
    productId: string,
    group: NonNullable<StaffOrderCatalog["products"][number]["bundleChoiceGroups"]>[number],
    choiceId: string | null,
  ) {
    setBundleSelections((current) => ({
      ...current,
      [productId]: toggleBundleChoice(current[productId] ?? [], group, choiceId),
    }));
  }

  async function submit() {
    if (selectedItems.length === 0) {
      setMessage(Object.values(quantities).some((quantity) => quantity > 0)
        ? t("composer.addPendingItem")
        : t("composer.addAtLeastOne"));
      return;
    }
    const invalidNotes = selectedItems.find(({ product, noteOptionIds }) => (
      !noteSelectionIsValid(product.noteGroups, noteOptionIds)
    ));
    if (invalidNotes) {
      setMessage(t("composer.requiredNotes", { item: localizedStaffProduct(invalidNotes.product, locale).name }));
      return;
    }
    const invalidBundle = selectedItems.find(({ product, bundleChoiceIds }) => (
      !bundleSelectionIsValid(product, bundleChoiceIds)
    ));
    if (invalidBundle) {
      setMessage(t("composer.requiredBundle", { item: localizedStaffProduct(invalidBundle.product, locale).name }));
      return;
    }
    if (fulfillmentType === "DINE_IN" && !diningTableId) {
      setMessage(t("composer.tableRequired"));
      return;
    }
    if (customerPhone.trim() && !PHONE_NUMBER.test(customerPhone.trim())) {
      setMessage(t("composer.phoneInvalid"));
      return;
    }
    if (
      (fulfillmentType === "TAKEOUT" || fulfillmentType === "DELIVERY")
      && requestedFulfillmentAt
      && !fulfillmentTimeSlots.some((slot) => slot.iso === requestedFulfillmentAt)
    ) {
      setMessage(t("composer.slotInvalid", { kind: fulfillmentType === "DELIVERY" ? t("composer.deliveryTime") : t("composer.pickupTime") }));
      return;
    }
    if (paymentTiming === "PAY_NOW") {
      if (modules.payment && !payment) {
        setMessage(t("composer.paymentRequired"));
        return;
      }
      if (usesCash && (!Number.isInteger(received) || received < total)) {
        setMessage(t("composer.cashInsufficient"));
        return;
      }
      if (needsApproval && (!discountApprovalReason.trim()
        || (!operatorCanApprove && !/^\d{4,8}$/.test(managerAuthorizationCode)))) {
        setMessage(t("composer.approvalIncomplete"));
        return;
      }
    }

    setBusy(true);
    setMessage("");
    const fulfillment = fulfillmentType === "DINE_IN"
      ? { fulfillmentType, diningTableId, customerPhone }
      : fulfillmentType === "DELIVERY"
        ? { fulfillmentType, customerPhone, deliveryAddress, requestedFulfillmentAt: requestedFulfillmentAt || null }
        : { fulfillmentType, customerPhone, requestedFulfillmentAt: requestedFulfillmentAt || null };
    const idempotencyKey = idempotencyKeyRef.current;
    const requestBody = {
      ...fulfillment,
      idempotencyKey,
      customerName,
      customerNote,
      paymentTiming,
      checkout: paymentTiming === "PAY_NOW" ? {
        paymentOptionId: modules.payment ? paymentOptionId : null,
        discountOptionId: modules.discount ? applicableDiscountOptionId : null,
        cashReceived: usesCash ? received : null,
        discountApprovalReason: needsApproval ? discountApprovalReason : null,
        managerAuthorizationCode: needsApproval && !operatorCanApprove ? managerAuthorizationCode : null,
      } : undefined,
      items: selectedItems.map(({ product, quantity, noteOptionIds, bundleChoiceIds }) => ({
        productId: product.id,
        quantity,
        note: "",
        noteOptionIds,
        bundleChoiceIds,
      })),
    };
    try {
      let response: Response;
      try {
        response = await fetch(`/api/stalls/${stall.slug}/orders`, {
          method: "POST",
          headers: csrfHeaders(),
          body: JSON.stringify(requestBody),
        });
      } catch (error) {
        await createOfflineFallback(error);
        return;
      }
      let payload: { order?: StaffOrderDto; code?: string };
      try {
        payload = await response.json() as { order?: StaffOrderDto; code?: string };
      } catch (error) {
        if (response.ok || isTemporaryOrderFailure(response.status)) {
          await createOfflineFallback(error);
          return;
        }
        throw new Error(t("composer.createFailed"));
      }
      if (!response.ok) {
        if (isTemporaryOrderFailure(response.status)) {
          await createOfflineFallback(new Error("ORDER_INTAKE_TEMPORARILY_UNAVAILABLE"));
          return;
        }
        throw new Error(getOperationsErrorMessage(locale, payload.code, "composer.createFailed"));
      }
      if (!payload.order) {
        await createOfflineFallback(new Error("ORDER_RESPONSE_MISSING"));
        return;
      }
      idempotencyKeyRef.current = createWebUuid();
      consumeActiveDraft();
      onCreated(payload.order);
      if (paymentTiming === "PAY_NOW" && usesCash) {
        window.dispatchEvent(new Event("stallorder:cash-payment-completed"));
      }
    } catch (error) {
      setMessage(error instanceof Error
        ? getOperationsErrorMessage(locale, error.message, "composer.createFailed")
        : t("composer.createFailed"));
    } finally {
      setBusy(false);
    }

    async function createOfflineFallback(cause: unknown) {
      const canFallback = !navigator.onLine
        || cause instanceof TypeError
        || (cause instanceof Error && [
          "OFFLINE_READ_ONLY",
          "ORDER_INTAKE_TEMPORARILY_UNAVAILABLE",
          "ORDER_RESPONSE_MISSING",
        ].includes(cause.message));
      if (!canFallback) throw cause;
      if (fulfillmentType !== "TAKEOUT") {
        throw new Error("OFFLINE_TAKEOUT_ONLY");
      }
      if (requestedFulfillmentAt) {
        throw new Error("OFFLINE_SCHEDULED_TIME_NOT_ALLOWED");
      }
      if (applicableDiscountOptionId !== null || needsApproval) {
        throw new Error("OFFLINE_DISCOUNT_NOT_ALLOWED");
      }
      if (selectedItems.some(({ product }) => product.kind === "BUNDLE")) {
        throw new Error("OFFLINE_BUNDLE_NOT_ALLOWED");
      }
      const [{ createOfflineOrder }, { offlineOrderToStaffOrder }] = await Promise.all([
        import("@/offline/offline-operations"),
        import("@/offline/offline-staff-order"),
      ]);
      const created = await createOfflineOrder({
        organizationId: stall.organizationId,
        stallId: stall.id,
        idempotencyKey,
        customerLabel: customerName,
        customerContact: customerPhone,
        note: customerNote,
        paymentTiming,
        paymentOptionId: paymentTiming === "PAY_NOW" ? paymentOptionId : null,
        cashReceived: paymentTiming === "PAY_NOW" && usesCash ? received : null,
        queuePrint: modules.print,
        items: requestBody.items,
      });
      idempotencyKeyRef.current = createWebUuid();
      consumeActiveDraft();
      onCreated(offlineOrderToStaffOrder(created.order));
      if (paymentTiming === "PAY_NOW" && usesCash) {
        window.dispatchEvent(new Event("stallorder:cash-payment-completed"));
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/45 print:hidden sm:p-6">
      <section role="dialog" aria-modal="true" aria-labelledby="staff-order-title" className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden bg-white shadow-xl sm:rounded-lg">
        <header className="z-20 flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-stone-200 bg-white px-4 py-3 sm:rounded-t-lg sm:px-6 md:gap-4 md:py-4">
          <div>
            <h2 id="staff-order-title" className="text-xl font-semibold">{t("composer.title")}</h2>
            <p className="mt-1 hidden text-sm text-stone-600 md:block">{t("composer.description")}</p>
          </div>
          <div data-testid="staff-composer-mobile-toolbar" className="grid w-full grid-cols-5 gap-2 md:flex md:w-auto md:flex-wrap md:justify-end">
            <button
              data-testid="staff-save-draft"
              type="button"
              title={t("composer.draft.saveNew")}
              aria-label={t("composer.draft.saveNew")}
              disabled={busy}
              onClick={saveCurrentDraft}
              className="grid h-11 min-w-0 place-items-center rounded-md border border-teal-300 bg-teal-50 text-sm font-semibold text-teal-900 disabled:opacity-50 md:inline-flex md:w-auto md:gap-2 md:px-3"
            >
              <Save className="h-5 w-5 md:h-4 md:w-4" />
              <span className="sr-only md:not-sr-only">{t("composer.draft.saveNew")}</span>
            </button>
            <button
              data-testid="staff-open-drafts"
              type="button"
              title={t("composer.draft.count", { count: savedDrafts.length, limit: STAFF_ORDER_DRAFT_LIMIT })}
              aria-label={t("composer.draft.count", { count: savedDrafts.length, limit: STAFF_ORDER_DRAFT_LIMIT })}
              disabled={busy}
              onClick={() => setDraftManagerOpen(true)}
              className="relative grid h-11 min-w-0 place-items-center rounded-md border border-stone-300 text-sm font-semibold text-stone-700 disabled:opacity-50 md:inline-flex md:w-auto md:gap-2 md:px-3"
            >
              <ArchiveRestore className="h-5 w-5 md:h-4 md:w-4" />
              <span className="sr-only md:not-sr-only">{t("composer.draft.count", { count: savedDrafts.length, limit: STAFF_ORDER_DRAFT_LIMIT })}</span>
              <span aria-hidden="true" className="absolute right-1 top-1 min-w-4 rounded-full bg-stone-800 px-1 text-center text-[10px] leading-4 text-white md:hidden">{savedDrafts.length}</span>
            </button>
            <button
              data-testid="staff-order-menu-tab"
              type="button"
              title={t("composer.chooseProducts")}
              aria-label={t("composer.chooseProducts")}
              aria-pressed={activePane === "MENU"}
              onClick={() => switchPane("MENU")}
              className={`grid h-11 min-w-0 place-items-center rounded-md border md:hidden ${activePane === "MENU" ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 text-stone-600"}`}
            >
              <List className="h-5 w-5" />
              <span className="sr-only">{t("composer.chooseProducts")}</span>
            </button>
            <button
              data-testid="staff-order-cart-tab"
              type="button"
              title={t("composer.orderAndCheckout", { count: totalQuantity })}
              aria-label={t("composer.orderAndCheckout", { count: totalQuantity })}
              aria-pressed={activePane === "CART"}
              onClick={() => switchPane("CART")}
              className={`relative grid h-11 min-w-0 place-items-center rounded-md border md:hidden ${activePane === "CART" ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 text-stone-600"}`}
            >
              <ShoppingCart className="h-5 w-5" />
              <span className="sr-only">{t("composer.orderAndCheckout", { count: totalQuantity })}</span>
              <span aria-hidden="true" className="absolute right-1 top-1 min-w-4 rounded-full bg-stone-800 px-1 text-center text-[10px] leading-4 text-white">{totalQuantity}</span>
            </button>
            <button type="button" title={t("composer.close")} aria-label={t("composer.close")} disabled={busy} onClick={onClose} className="grid h-11 min-w-0 place-items-center rounded-md border border-stone-300 md:w-11"><X className="h-5 w-5 md:h-4 md:w-4" /></button>
          </div>
          <div className={`w-full text-xs leading-5 text-stone-600 ${activeDraftId || draftNotice ? "block" : "hidden md:block"}`}>
            <p className="hidden border-t border-stone-100 pt-3 md:block">{t("composer.draft.policy")}</p>
            {activeDraftId ? <p className="font-semibold text-teal-800 md:mt-1">{t("composer.draft.editing")}</p> : null}
            {draftNotice ? <p role="status" className="font-semibold text-teal-800 md:mt-1">{draftNotice}</p> : null}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_360px]">
          <div ref={menuScrollRef} data-testid="staff-order-menu-panel" className={`${activePane === "MENU" ? "block" : "hidden"} min-h-0 overflow-y-auto overscroll-contain px-4 py-5 pb-28 sm:px-6 md:block md:pb-5`}>
            <div className="grid grid-cols-3 gap-2" aria-label={t("composer.fulfillmentMethod")}>
              <ModeButton active={fulfillmentType === "TAKEOUT"} icon={<Package className="h-4 w-4" />} label={t("composer.takeout")} onClick={() => selectFulfillmentType("TAKEOUT")} />
              <ModeButton active={fulfillmentType === "DINE_IN"} disabled={!modules.dineIn || catalog.tables.length === 0} icon={<Utensils className="h-4 w-4" />} label={t("composer.dineIn")} onClick={() => selectFulfillmentType("DINE_IN")} />
              <ModeButton active={fulfillmentType === "DELIVERY"} disabled={!modules.delivery} icon={<Truck className="h-4 w-4" />} label={t("composer.delivery")} onClick={() => selectFulfillmentType("DELIVERY")} />
            </div>

            <div className="mt-5 grid items-start gap-3 sm:grid-cols-2">
              <TextField className="mt-0" label={t("composer.customerNameOptional")} value={customerName} maxLength={50} autoComplete="name" onChange={setCustomerName} />
              {(fulfillmentType === "TAKEOUT" || fulfillmentType === "DELIVERY") ? <TextField className="mt-0" label={t("composer.contactPhoneOptional")} value={customerPhone} maxLength={30} type="tel" inputMode="tel" autoComplete="tel" pattern={PHONE_INPUT_PATTERN} onChange={setCustomerPhone} /> : null}
              {fulfillmentType === "DINE_IN" ? <label className="block text-xs font-semibold text-stone-600">{t("composer.table")}<select value={diningTableId} onChange={(event) => setDiningTableId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm">{tableGroups.map(([floorName, tables]) => <optgroup key={floorName} label={floorName}>{tables.map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}</optgroup>)}</select></label> : null}
              {fulfillmentType === "DELIVERY" ? <label className="text-xs font-semibold text-stone-600 sm:col-span-2">{t("composer.deliveryAddressOptional")}<textarea autoComplete="street-address" value={deliveryAddress} maxLength={300} onChange={(event) => setDeliveryAddress(event.target.value)} className="form-input mt-1 min-h-20" /></label> : null}
              {fulfillmentType === "TAKEOUT" && fulfillmentTimeSlots.length > 0 ? (
                <FulfillmentTimePicker
                  slots={fulfillmentTimeSlots}
                  value={requestedFulfillmentAt}
                  onChange={setRequestedFulfillmentAt}
                  legend={t("composer.pickupTimeLegend")}
                  scheduledLabel={t("composer.scheduledPickup")}
                  dateLabel={t("composer.pickupDate")}
                  timeLabel={t("composer.pickupTime")}
                  unavailableDateMessage={t("composer.pickupUnavailable")}
                  allowAsap
                  required={false}
                  testId="staff-takeout-fulfillment-time-fields"
                  className="sm:col-span-2"
                />
              ) : null}
              {fulfillmentType === "DELIVERY" && fulfillmentTimeSlots.length > 0 ? (
                <FulfillmentTimePicker
                  slots={fulfillmentTimeSlots}
                  value={requestedFulfillmentAt}
                  onChange={setRequestedFulfillmentAt}
                  legend={t("composer.deliveryTimeLegend")}
                  scheduledLabel={t("composer.scheduledDelivery")}
                  dateLabel={t("composer.deliveryDate")}
                  timeLabel={t("composer.deliveryTime")}
                  unavailableDateMessage={t("composer.deliveryUnavailable")}
                  allowAsap
                  required={false}
                  testId="staff-delivery-fulfillment-time-fields"
                  className="sm:col-span-2"
                />
              ) : null}
            </div>

            <div className="mt-6 flex min-h-12 items-center justify-between gap-3 border-y border-stone-200 py-2">
              <p className="text-sm font-semibold text-stone-700">{t("composer.productList", { count: catalog.products.length })}</p>
              <button
                type="button"
                data-testid="staff-product-list-toggle"
                aria-expanded={catalogExpanded}
                aria-controls="staff-product-list"
                onClick={toggleCatalog}
                className="min-h-11 rounded-md border border-stone-300 px-3 text-sm font-semibold text-teal-800"
              >
                {catalogExpanded ? t("composer.collapseAll") : t("composer.expandAll")}
              </button>
            </div>

            {catalogExpanded ? <div id="staff-product-list" data-testid="staff-product-list">
            <nav data-testid="staff-group-navigation" aria-label={t("composer.groups")} className="sticky top-0 z-10 -mx-4 mt-2 flex gap-2 overflow-x-auto border-y border-stone-200 bg-white/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
              {catalogNavigationItems.map((item) => <a key={item.id} href={`#${item.id}`} aria-current={activeCatalogAnchor === item.id ? "true" : undefined} onClick={(event) => { event.preventDefault(); scrollToCatalogTarget(item); }} className={`inline-flex min-h-11 shrink-0 items-center rounded-md border px-3 text-sm font-semibold ${activeCatalogAnchor === item.id ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white text-stone-700"}`}>{item.label}</a>)}
            </nav>

            <div className="mt-7 space-y-7">
              {catalogNavigationItems.map((catalogSection) => {
                const sectionCollapsed = collapsedCatalogSections.has(catalogSection.key);
                const sectionPanelId = `${catalogSection.id}-products`;
                return (
                <section key={catalogSection.key} id={catalogSection.id} data-testid="staff-product-group" data-category={catalogSection.category} data-group={catalogSection.group ?? undefined} className="scroll-mt-16">
                  <h3 className="border-b border-stone-200">
                    <button
                      type="button"
                      aria-expanded={!sectionCollapsed}
                      aria-controls={sectionPanelId}
                      aria-label={t("composer.groupToggle", { action: sectionCollapsed ? t("common.expand") : t("common.collapse"), group: catalogSection.label })}
                      onClick={() => toggleCatalogSection(catalogSection.key)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 pb-2 text-left text-sm font-semibold text-stone-600"
                    >
                      <span>{catalogSection.label}</span>
                      <span className="inline-flex items-center gap-1 text-xs text-teal-800">
                        {sectionCollapsed ? t("staff.order.expand") : t("staff.order.collapse")}
                        <ChevronDown className={`h-4 w-4 transition-transform ${sectionCollapsed ? "" : "rotate-180"}`} />
                      </span>
                    </button>
                  </h3>
                  {!sectionCollapsed ? <div id={sectionPanelId} className="divide-y divide-stone-100">
                    {catalogSection.products.map((product) => {
                      const quantity = quantities[product.id] ?? 0;
                      const cartQuantity = cartQuantitiesByProduct.get(product.id) ?? 0;
                      const noteSelected = noteSelections[product.id] ?? [];
                      const bundleSelected = bundleSelections[product.id] ?? [];
                      const productCopy = localizedStaffProduct(product, locale);
                      const unitPrice = Math.max(
                        0,
                        product.price
                          + bundlePriceAdjustment(product, bundleSelected)
                          + notePriceAdjustment(product.noteGroups, noteSelected),
                      );
                      return <article key={product.id} id={`staff-product-${product.id}`} data-testid="staff-product-card" className="py-4">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
                          <div className="min-w-0">
                            <h4 className="font-semibold">{productCopy.name}{product.kind === "BUNDLE" ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{t("composer.bundle")}</span> : null}</h4>
                            {productCopy.description ? <p className="mt-1 text-sm text-stone-500">{productCopy.description}</p> : null}
                        <p className="mt-1 text-sm font-semibold">{formatMoney(unitPrice, stall.currency, locale)}</p>
                            {cartQuantity > 0 ? <p className="mt-1 text-xs font-medium text-teal-800">{t("composer.inCart", { count: cartQuantity })}</p> : null}
                          </div>
                          <div className="grid grid-cols-[44px_32px_44px] items-center gap-2">
                            <button type="button" title={t("composer.decreaseItem", { item: productCopy.name })} disabled={quantity === 0} onClick={() => setQuantity(product.id, quantity - 1)} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                            <span className="text-center font-semibold">{quantity}</span>
                            <button type="button" title={t("composer.increaseItem", { item: productCopy.name })} onClick={() => setQuantity(product.id, quantity + 1)} className="grid h-11 w-11 place-items-center rounded-md bg-teal-800 text-white"><Plus className="h-4 w-4" /></button>
                          </div>
                        </div>
                        {quantity > 0 && product.kind === "BUNDLE" ? <div className="mt-4 space-y-3">
                          {(product.bundleChoiceGroups ?? []).map((group) => {
                            const groupIds = new Set(group.choices.map((choice) => choice.id));
                            const selectedCount = bundleSelected.filter((id) => groupIds.has(id)).length;
                            return <fieldset key={group.id} className="rounded-md border border-teal-200 bg-teal-50/60 p-3">
                              <legend className="px-2 text-sm font-bold text-teal-950"><span className="mr-2 inline-flex rounded-full bg-teal-800 px-2 py-0.5 text-xs text-white">{t("composer.bundleGroup")}</span>{group.name}{group.minSelections > 0 ? " *" : ""}<span className="ml-2 text-xs font-normal text-stone-600">{group.minSelections === group.maxSelections ? t("composer.chooseExact", { count: group.minSelections }) : t("composer.chooseRange", { min: group.minSelections, max: group.maxSelections })}</span></legend>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                                {group.maxSelections === 1 && group.minSelections === 0 ? <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="radio" name={`staff-bundle-${product.id}-${group.id}`} checked={selectedCount === 0} onChange={() => selectBundleChoice(product.id, group, null)} />{t("composer.noSelection")}</label> : null}
                                {group.choices.map((choice) => {
                                  const checked = bundleSelected.includes(choice.id);
                                  const maxed = selectedCount >= group.maxSelections;
                                  return <label key={choice.id} className="inline-flex min-h-11 items-center gap-2 text-sm"><input type={group.maxSelections === 1 ? "radio" : "checkbox"} name={`staff-bundle-${product.id}-${group.id}`} checked={checked} disabled={group.maxSelections > 1 && maxed && !checked} onChange={() => selectBundleChoice(product.id, group, choice.id)} />{localizedStaffName(choice.name, choice.translations, locale)} × {choice.quantity}{choice.priceDelta !== 0 ? <span className="text-teal-800">{choice.priceDelta > 0 ? "+" : ""}{formatMoney(choice.priceDelta, stall.currency, locale)}</span> : null}</label>;
                                })}
                              </div>
                            </fieldset>;
                          })}
                        </div> : null}
                        {quantity > 0 && product.noteGroups.length > 0 ? <div className="mt-4 space-y-3 border-l-2 border-teal-700 pl-3">{product.noteGroups.map((group) => { const optionIds = new Set(group.options.map((option) => option.id)); const selectedCount = noteSelected.filter((id) => optionIds.has(id)).length; return <fieldset key={group.id}><legend className="text-sm font-semibold">{localizedStaffName(group.name, group.translations, locale)}{group.isRequired ? " *" : ""}<span className="ml-2 text-xs font-normal text-stone-500">{group.selectionMode === "SINGLE" ? t("composer.singleChoice") : group.maxSelections ? t("composer.maxChoices", { count: group.maxSelections }) : t("composer.multipleChoice")}</span></legend><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{group.selectionMode === "SINGLE" && !group.isRequired ? <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="radio" name={`staff-note-${product.id}-${group.id}`} checked={selectedCount === 0} onChange={() => selectNoteOption(product.id, group, null)} />{t("composer.noSelection")}</label> : null}{group.options.map((option) => { const checked = noteSelected.includes(option.id); const maxed = group.maxSelections !== null && selectedCount >= group.maxSelections; return <label key={option.id} className="inline-flex min-h-11 items-center gap-2 text-sm"><input type={group.selectionMode === "SINGLE" ? "radio" : "checkbox"} name={`staff-note-${product.id}-${group.id}`} checked={checked} disabled={group.selectionMode === "MULTIPLE" && maxed && !checked} onChange={() => selectNoteOption(product.id, group, option.id)} />{localizedStaffName(option.name, option.translations, locale)}{option.priceDelta !== 0 ? <span className="text-teal-800">{option.priceDelta > 0 ? "+" : ""}{formatMoney(option.priceDelta, stall.currency, locale)}</span> : null}</label>; })}</div></fieldset>; })}</div> : null}
                        {quantity > 0 ? <button type="button" onClick={() => addProductToCart(product)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white"><ShoppingCart className="h-4 w-4" />{editingLineIds[product.id] ? t("composer.updateDone") : t("composer.addToCart")}</button> : null}
                        </article>;
                    })}
                  </div> : null}
                </section>
                );
              })}
              {catalog.products.length === 0 ? <p className="py-12 text-center text-sm text-stone-500">{t("composer.noProducts")}</p> : null}
            </div>
            </div> : <p role="status" className="py-5 text-center text-sm text-stone-500">{t("composer.collapsedNotice")}</p>}
            {selectedItems.length > 0 ? <button data-testid="staff-mobile-cart-summary" type="button" onClick={() => switchPane("CART")} className="safe-area-bottom fixed inset-x-3 bottom-0 z-30 flex min-h-16 items-center gap-3 rounded-t-lg bg-stone-900 px-4 pt-3 text-left text-white shadow-2xl md:hidden"><ShoppingCart className="h-5 w-5" /><span className="flex-1"><span className="block text-xs text-stone-300">{t("common.portions", { count: totalQuantity })}</span><strong>{formatMoney(total, stall.currency, locale)}</strong></span><span className="text-sm font-semibold">{t("composer.checkout")}</span></button> : null}
          </div>

          <aside ref={cartScrollRef} data-testid="staff-order-cart-panel" className={`${activePane === "CART" ? "flex" : "hidden"} safe-area-bottom min-h-0 flex-col overflow-y-auto overscroll-contain border-t border-stone-200 bg-stone-50 px-4 py-5 sm:px-6 md:flex md:h-full md:overflow-hidden md:border-l md:border-t-0`}>
            <div className="flex shrink-0 items-center gap-2"><ShoppingCart className="h-4 w-4 text-teal-800" /><h3 className="font-semibold">{t("composer.currentOrder")}</h3><span className="ml-auto text-sm text-stone-500">{t("common.portions", { count: totalQuantity })}</span></div>
            <div data-testid="staff-order-cart-lines" className="mt-3 divide-y divide-stone-200 border-y border-stone-200 md:min-h-32 md:flex-1 md:overflow-y-auto md:overscroll-contain md:pr-1">{selectedItems.map(({ cartLineId, product, quantity, noteOptionIds, bundleChoiceIds }) => {
              const productCopy = localizedStaffProduct(product, locale);
              const selectedBundleChoices = (product.bundleChoiceGroups ?? []).flatMap((group) => (
                group.choices.filter((choice) => bundleChoiceIds.includes(choice.id))
              ));
              const selectedNoteNames = product.noteGroups.flatMap((group) => (
                group.options
                  .filter((option) => noteOptionIds.includes(option.id))
                  .map((option) => localizedStaffName(option.name, option.translations, locale))
              ));
              const configurationLabel = [
                ...selectedBundleChoices.map((choice) => `${localizedStaffName(choice.name, choice.translations, locale)} × ${choice.quantity}`),
                ...selectedNoteNames,
              ].join(" · ") || t("composer.noConfiguration");
              const unitPrice = Math.max(
                0,
                product.price
                  + bundlePriceAdjustment(product, bundleChoiceIds)
                  + notePriceAdjustment(product.noteGroups, noteOptionIds),
              );
              return <div key={cartLineId} data-testid="staff-cart-line" data-cart-line-id={cartLineId} className="py-3 text-sm">
                  <div className="flex justify-between gap-3"><span>{quantity} × {productCopy.name}</span><strong>{formatMoney(unitPrice * quantity, stall.currency, locale)}</strong></div>
                {selectedBundleChoices.length > 0 ? <p className="mt-1 text-xs text-amber-800">{selectedBundleChoices.map((choice) => `${localizedStaffName(choice.name, choice.translations, locale)} × ${choice.quantity}`).join(optionSeparator)}</p> : null}
                {selectedNoteNames.length > 0 ? <p className="mt-1 text-xs text-teal-800">{selectedNoteNames.join(optionSeparator)}</p> : null}
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  <button type="button" aria-label={t("composer.decreaseConfiguredItem", { item: productCopy.name, configuration: configurationLabel })} onClick={() => changeCartLineQuantity(cartLineId, quantity - 1)} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 bg-white"><Minus className="h-4 w-4" /></button>
                  <span className="min-w-8 text-center font-semibold" aria-label={t("composer.itemQuantity", { item: productCopy.name, configuration: configurationLabel })}>{quantity}</span>
                  <button type="button" aria-label={t("composer.increaseConfiguredItem", { item: productCopy.name, configuration: configurationLabel })} onClick={() => changeCartLineQuantity(cartLineId, quantity + 1)} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 bg-white"><Plus className="h-4 w-4" /></button>
                  {(product.noteGroups.length > 0 || (product.bundleChoiceGroups?.length ?? 0) > 0) ? <button type="button" onClick={() => editCartLine({ id: cartLineId, productId: product.id, quantity, note: "", noteOptionIds, bundleChoiceIds })} className="min-h-11 rounded-md border border-teal-300 bg-white px-3 font-semibold text-teal-800">{t("composer.editCustomization")}</button> : null}
                  <button type="button" aria-label={t("composer.removeItem", { item: productCopy.name, configuration: configurationLabel })} onClick={() => changeCartLineQuantity(cartLineId, 0)} className="min-h-11 rounded-md border border-red-300 bg-white px-3 font-semibold text-red-700">{t("composer.remove")}</button>
                </div>
              </div>;
            })}</div>
            <div data-testid="staff-order-checkout-controls" className="shrink-0 md:max-h-[55%] md:overflow-y-auto md:overscroll-contain md:pr-1">
              <label className="mt-4 block text-xs font-semibold text-stone-600">{t("composer.customerNote")}<textarea value={customerNote} maxLength={catalog.limits.maxNoteLength} onChange={(event) => setCustomerNote(event.target.value)} className="form-input mt-1 min-h-20" /></label>

            <div className="mt-5 grid grid-cols-2 rounded-md border border-stone-300 bg-white p-1" aria-label={t("composer.paymentTiming")}>
              <button type="button" aria-pressed={paymentTiming === "PAY_NOW"} onClick={() => setPaymentTiming("PAY_NOW")} className={`h-11 rounded text-xs font-semibold ${paymentTiming === "PAY_NOW" ? "bg-stone-900 text-white" : "text-stone-600"}`}>{t("composer.payNow")}</button>
              <button type="button" aria-pressed={paymentTiming === "PAY_LATER"} onClick={() => setPaymentTiming("PAY_LATER")} className={`h-11 rounded text-xs font-semibold ${paymentTiming === "PAY_LATER" ? "bg-stone-900 text-white" : "text-stone-600"}`}>{t("composer.payLater")}</button>
            </div>

            {paymentTiming === "PAY_NOW" ? <>
              {modules.payment ? <div className="mt-4 grid grid-cols-2 gap-2">{paymentOptions.map((option) => <button key={option.id} type="button" aria-pressed={paymentOptionId === option.id} onClick={() => { setPaymentOptionId(option.id); setCashReceived(""); }} className={`min-h-11 rounded-md border px-2 text-xs font-semibold ${paymentOptionId === option.id ? "border-teal-700 bg-teal-50" : "border-stone-300 bg-white"}`}>{option.name}</button>)}</div> : <p className="mt-4 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold">{t("composer.cash")}</p>}
              <StaffDiscountSelector
                enabled={modules.discount}
                options={discountOptions}
                selectedOptionId={applicableDiscountOptionId}
                onSelect={setDiscountOptionId}
                settingsHref={discountSettingsHref}
                isApplicable={discountEligibleSubtotal > 0}
              />
              {discountEligibleSubtotal < subtotal ? <p className="mt-2 text-xs text-amber-800">{t("composer.discountEligible", { amount: formatMoney(discountEligibleSubtotal, stall.currency, locale) })}</p> : null}
              {needsApproval ? <div className="mt-4 border-y border-amber-300 bg-amber-50 py-3"><p className="text-xs font-semibold text-amber-900">{t("composer.approvalRequired")}</p><TextField label={t("composer.approvalReason")} value={discountApprovalReason} maxLength={200} onChange={setDiscountApprovalReason} />{!operatorCanApprove ? <TextField label={t("composer.managerAuthorizationCode")} value={managerAuthorizationCode} maxLength={8} onChange={(value) => setManagerAuthorizationCode(value.replace(/\D/g, "").slice(0, 8))} type="password" inputMode="numeric" autoComplete="one-time-code" /> : null}</div> : null}
              {usesCash ? <div className="mt-4"><TextField label={t("composer.cashReceived")} value={cashReceived} maxLength={9} inputMode="numeric" onChange={(value) => setCashReceived(value.replace(/\D/g, ""))} /><div className="mt-2 grid grid-cols-4 gap-2">{[total, 200, 500, 1000].filter((value, index, values) => values.indexOf(value) === index).map((value, index) => <button key={value} type="button" disabled={value < total} onClick={() => setCashReceived(String(value))} className="h-11 rounded-md border border-stone-300 bg-white text-xs font-semibold disabled:opacity-40">{index === 0 ? t("composer.exact") : value}</button>)}</div><div className="mt-3 flex justify-between bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900"><span>{t("composer.change")}</span><span>{formatMoney(change, stall.currency, locale)}</span></div></div> : null}
            </> : null}

            <dl className="mt-5 space-y-2 border-y border-stone-200 py-4 text-sm"><div className="flex justify-between"><dt>{t("composer.subtotal")}</dt><dd>{formatMoney(subtotal, stall.currency, locale)}</dd></div>{paymentTiming === "PAY_NOW" && discount ? <div className="flex justify-between text-emerald-800"><dt>{discount.name}</dt><dd>-{formatMoney(subtotal - total, stall.currency, locale)}</dd></div> : null}<div className="flex justify-between text-lg font-semibold"><dt>{paymentTiming === "PAY_NOW" ? t("composer.amountDue") : t("composer.orderAmount")}</dt><dd>{formatMoney(paymentTiming === "PAY_NOW" ? total : subtotal, stall.currency, locale)}</dd></div></dl>
            {message ? <p role="alert" className="mt-4 text-sm text-red-700">{message}</p> : null}
              <button type="button" disabled={busy || selectedItems.length === 0} onClick={() => void submit()} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-40"><Send className="h-4 w-4" />{busy ? t("composer.creating") : paymentTiming === "PAY_NOW" ? t("composer.createPaid") : t("composer.createKitchen")}</button>
            </div>
          </aside>
        </div>
      </section>
      {draftManagerOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="staff-drafts-title" className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><h3 id="staff-drafts-title" className="text-xl font-semibold">{t("composer.draft.deviceTitle")}</h3><p className="mt-1 text-sm leading-6 text-stone-600">{t("composer.draft.expiry")}</p></div>
              <button type="button" title={t("composer.draft.close")} onClick={() => setDraftManagerOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300"><X className="h-4 w-4" /></button>
            </div>
            <div data-testid="staff-draft-list" className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
              {savedDrafts.map((draft) => (
                <article key={draft.id} data-testid="staff-draft-card" className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h4 className="font-semibold">{draft.label}</h4><p className="mt-1 text-xs text-stone-500">{t("common.portions", { count: draft.itemCount })} · {formatAppDateTime(locale, draft.savedAt, { dateStyle: "short", timeStyle: "short" })}{activeDraftId === draft.id ? ` · ${t("composer.draft.current")}` : ""}</p></div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => restoreSavedDraft(draft)} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-800 px-3 text-sm font-semibold text-white"><ArchiveRestore className="h-4 w-4" />{t("composer.draft.restore")}</button>
                      <button type="button" aria-label={t("composer.draft.deleteLabel", { label: draft.label })} onClick={() => deleteSavedDraft(draft)} className="grid h-11 w-11 place-items-center rounded-md border border-red-300 text-red-700"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                </article>
              ))}
              {savedDrafts.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">{t("composer.draft.empty")}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function staffOrderDraftStorageKey(organizationId: string, stallId: string) {
  return `stallorder_staff_order_drafts:${encodeURIComponent(organizationId)}:${encodeURIComponent(stallId)}`;
}

function savedAtFromQrCartDraft(raw: string) {
  const parsed = JSON.parse(raw) as { savedAt?: unknown };
  if (typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) {
    throw new Error("STAFF_ORDER_DRAFT_TIMESTAMP_MISSING");
  }
  return parsed.savedAt;
}

function parseStaffOrderDrafts(raw: string | null, now = Date.now()): StaffOrderDraft[] {
  if (!raw || raw.length > STAFF_ORDER_DRAFT_LIMIT * STAFF_ORDER_DRAFT_MAX_BYTES) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((candidate): StaffOrderDraft[] => {
    if (!isRecord(candidate)
      || candidate.version !== STAFF_ORDER_DRAFT_VERSION
      || typeof candidate.id !== "string"
      || typeof candidate.savedAt !== "number"
      || !Number.isFinite(candidate.savedAt)
      || candidate.savedAt > now
      || now - candidate.savedAt > QR_CART_TTL_MS
      || typeof candidate.label !== "string"
      || typeof candidate.itemCount !== "number"
      || !Number.isInteger(candidate.itemCount)
      || candidate.itemCount < 1
      || typeof candidate.cartDraft !== "string"
      || candidate.cartDraft.length > STAFF_ORDER_DRAFT_MAX_BYTES
      || !isFulfillmentType(candidate.fulfillmentType)
      || typeof candidate.diningTableId !== "string"
      || typeof candidate.requestedFulfillmentAt !== "string"
      || !isPaymentTiming(candidate.paymentTiming)
      || !(candidate.paymentOptionId === null || typeof candidate.paymentOptionId === "string")
      || !(candidate.discountOptionId === null || typeof candidate.discountOptionId === "string")
      || candidate.discountApprovalReason !== ""
      || !staffOrderCartDraftIsNonSensitive(candidate.cartDraft)) return [];
    return [{
      version: STAFF_ORDER_DRAFT_VERSION,
      id: candidate.id.slice(0, 100),
      savedAt: candidate.savedAt,
      label: candidate.label.slice(0, 80),
      itemCount: candidate.itemCount,
      cartDraft: candidate.cartDraft,
      fulfillmentType: candidate.fulfillmentType,
      diningTableId: candidate.diningTableId.slice(0, 100),
      requestedFulfillmentAt: candidate.requestedFulfillmentAt.slice(0, 64),
      paymentTiming: candidate.paymentTiming,
      paymentOptionId: candidate.paymentOptionId?.slice(0, 100) ?? null,
      discountOptionId: candidate.discountOptionId?.slice(0, 100) ?? null,
      discountApprovalReason: candidate.discountApprovalReason.slice(0, 200),
    }];
  }).sort((left, right) => right.savedAt - left.savedAt).slice(0, STAFF_ORDER_DRAFT_LIMIT);
}

function staffOrderCartDraftIsNonSensitive(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.lines)) return false;
    const sensitiveFields = [
      parsed.customerName,
      parsed.customerNote,
      parsed.customerPhone,
      parsed.deliveryAddress,
    ];
    return sensitiveFields.every((value) => value === "" || value === undefined)
      && parsed.lines.every((line) => isRecord(line) && (line.note === "" || line.note === undefined));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFulfillmentType(value: unknown): value is StaffOrderDraft["fulfillmentType"] {
  return value === "TAKEOUT" || value === "DINE_IN" || value === "DELIVERY";
}

function isPaymentTiming(value: unknown): value is StaffOrderDraft["paymentTiming"] {
  return value === "PAY_NOW" || value === "PAY_LATER";
}

function isTemporaryOrderFailure(status: number) {
  return status === 502 || status === 503 || status === 504;
}

type StaffCatalogProduct = StaffOrderCatalog["products"][number];
type StaffBundleChoiceGroup = NonNullable<StaffCatalogProduct["bundleChoiceGroups"]>[number];

export function buildStaffCatalogSections(products: StaffCatalogProduct[], locale: AppLocale) {
  const sections: Array<{
    key: string;
    label: string;
    category: string;
    group: string | null;
    products: StaffCatalogProduct[];
  }> = [];
  const sectionByKey = new Map<string, (typeof sections)[number]>();
  for (const product of products) {
    const group = product.group ?? null;
    const key = JSON.stringify([product.category, group]);
    let section = sectionByKey.get(key);
    if (!section) {
      section = {
        key,
        label: group
          ? localizedStaffName(group, product.groupTranslations, locale)
          : localizedStaffName(product.category, product.categoryTranslations, locale),
        category: product.category,
        group,
        products: [],
      };
      sections.push(section);
      sectionByKey.set(key, section);
    }
    section.products.push(product);
  }
  return sections;
}

export function localizedStaffProduct(product: StaffCatalogProduct, locale: AppLocale) {
  const translation = product.translations?.find((item) => item.locale === locale);
  return translation
    ? { name: translation.name, description: translation.description }
    : { name: product.name, description: product.description };
}

export function localizedStaffName(
  fallback: string,
  translations: Array<{ locale: string; name: string }> | undefined,
  locale: AppLocale,
) {
  return translations?.find((item) => item.locale === locale)?.name ?? fallback;
}

function bundleSelectionIsValid(product: StaffCatalogProduct, selectedIds: string[]) {
  if (new Set(selectedIds).size !== selectedIds.length) return false;
  if (product.kind !== "BUNDLE") return selectedIds.length === 0;
  const groups = product.bundleChoiceGroups ?? [];
  if (groups.length === 0) return false;
  const allowedIds = new Set(groups.flatMap((group) => group.choices.map((choice) => choice.id)));
  if (selectedIds.some((choiceId) => !allowedIds.has(choiceId))) return false;
  return groups.every((group) => {
    const choiceIds = new Set(group.choices.map((choice) => choice.id));
    const selectedCount = selectedIds.filter((choiceId) => choiceIds.has(choiceId)).length;
    return selectedCount >= group.minSelections && selectedCount <= group.maxSelections;
  });
}

function bundlePriceAdjustment(product: StaffCatalogProduct, selectedIds: string[]) {
  if (product.kind !== "BUNDLE") return 0;
  const selected = new Set(selectedIds);
  return (product.bundleChoiceGroups ?? []).reduce((sum, group) => (
    sum + group.choices.reduce((choiceSum, choice) => (
      choiceSum + (selected.has(choice.id) ? choice.priceDelta : 0)
    ), 0)
  ), 0);
}

function toggleBundleChoice(
  currentIds: string[],
  group: StaffBundleChoiceGroup,
  choiceId: string | null,
) {
  const groupIds = new Set(group.choices.map((choice) => choice.id));
  const outsideGroup = currentIds.filter((id) => !groupIds.has(id));
  if (choiceId === null) return outsideGroup;
  if (group.maxSelections === 1) return [...outsideGroup, choiceId];
  if (currentIds.includes(choiceId)) return currentIds.filter((id) => id !== choiceId);
  const selectedInGroup = currentIds.filter((id) => groupIds.has(id));
  if (selectedInGroup.length >= group.maxSelections) return currentIds;
  return [...currentIds, choiceId];
}

function ModeButton({ active, disabled, icon, label, onClick }: { active: boolean; disabled?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" disabled={disabled} aria-pressed={active} onClick={onClick} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-35 ${active ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white"}`}>{icon}{label}</button>;
}

function TextField({ className = "mt-3", label, value, maxLength, type = "text", inputMode, autoComplete, pattern, onChange }: { className?: string; label: string; value: string; maxLength: number; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string; pattern?: string; onChange: (value: string) => void }) {
  return <label className={`${className} block text-xs font-semibold text-stone-600`}>{label}<input type={type} inputMode={inputMode} autoComplete={autoComplete} pattern={pattern} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} className="form-input mt-1" /></label>;
}
