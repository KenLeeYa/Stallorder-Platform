import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ComponentProps, type ReactElement } from "react";
import type { CatalogLabels, ReadLabels } from "@/lib/operations-labels";
import { CatalogProductList } from "./catalog-product-list";
import { SharedCatalogManager } from "./shared-catalog-manager";
import { LazySharedCatalogManager } from "./lazy-shared-catalog-manager";

const h = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, invalidate: vi.fn(), remove: vi.fn() }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.states)) h.states[index] = typeof initial === "function" ? initial() : initial; return [h.states[index], (next: unknown) => { h.states[index] = typeof next === "function" ? next(h.states[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = h.cursor++; if (!(index in h.states)) h.states[index] = { current: initial }; return h.states[index]; },
  useEffect: () => {}, useLayoutEffect: () => {}, useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn, useSyncExternalStore: () => true,
}));
vi.mock("@/components/operations-query-provider", () => ({ useOperationsAuthority: () => ({ scope: { context: { kind: "organization", organizationId: "org" } } }), useOptionalOperationsAuthority: () => null }));
vi.mock("@/components/operations-read-feedback", () => ({ useOperationsOnline: () => true, OperationsReadFeedback: () => null }));
vi.mock("@/components/lazy-shared-catalog-manager", () => ({ LazySharedCatalogManager: () => null }));
vi.mock("@/lib/messages/merchant-client", () => ({ useMerchantMessages: () => ({ locale: "zh-TW", label: (key: string) => key, m: (key: string) => key }) }));
vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "content-type": "application/json" }), csrfFormHeaders: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({ queryOptions: (value: unknown) => value, useQueryClient: () => ({ invalidateQueries: h.invalidate, removeQueries: h.remove }), useQuery: (options: { queryKey: unknown }) => JSON.stringify(options.queryKey).includes("catalog-editor") ? { data: { editor: {} }, isPending: false } : { data: { rows: [{ id: "product", localizedName: "奶茶", defaultPrice: 50, isActive: true }], pagination: { page: 3, total: 30, totalPages: 6 } }, isPending: false } }));
vi.mock("@tanstack/react-table", () => ({ getCoreRowModel: () => ({}), flexRender: () => null, useReactTable: ({ data }: { data: unknown[] }) => ({ getRowModel: () => ({ rows: data.map(original => ({ id: "product", original, getVisibleCells: () => [] })) }), getHeaderGroups: () => [], getCanPreviousPage: () => true, getCanNextPage: () => true }) }));

type Node = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Node[] { if (Array.isArray(node)) return node.flatMap(elements); if (!isValidElement(node)) return []; const element = node as Node; return [element, ...Object.values(element.props).flatMap(elements)]; }
const input = { page: 3, pageSize: 5, q: "茶", locale: "zh-TW", active: "active", sort: "nameAsc" } as const;
const labels = new Proxy({}, { get: (_target, key) => key }) as CatalogLabels;
function renderList() { h.cursor = 0; return CatalogProductList({ initialInput: input, organizationName: "測試組織", labels, readLabels: {} as ReadLabels }); }
const product = { id: "product", name: "奶茶", description: "", categoryId: "category", groupId: null, defaultPrice: 50, kind: "SINGLE" as const, imageUrl: null, isOrderDiscountEligible: true, isLotteryEligible: false, sortOrder: 1, isActive: true, translations: [], stallProducts: [], bundleChoiceGroups: [] };
const managerProps: ComponentProps<typeof SharedCatalogManager> = { organizationId: "org", operatingMode: "SINGLE_STALL", currency: "TWD", stalls: [], initialCatalog: { categories: [{ id: "category", name: "茶", sortOrder: 1, isActive: true, translations: [] }], groups: [], products: [product] }, initialNoteGroups: [], initialReusableNotes: [], enabledTranslationLocales: [], aiTranslationConfigured: false, aiTranslationProviderLabel: "", initialProductId: "product" };
beforeEach(() => { h.states = []; h.cursor = 0; vi.clearAllMocks(); });

it("row edit keeps the filtered page visible and closes back to that exact list query", () => {
  const edit = elements(renderList()).find(e => e.props["aria-label"] === "編輯 奶茶")!;
  (edit.props.onClick as () => void)();
  const opened = elements(renderList());
  expect(opened.some(e => e.props.id === "catalog-heading")).toBe(true);
  expect(opened.some(e => e.type === "input" && e.props.value === "茶")).toBe(true);
  const manager = opened.find(e => e.type === LazySharedCatalogManager)!;
  expect(manager.props.initialProductId).toBe("product");
  (manager.props.onProductEditorClose as () => void)();
  expect(elements(renderList()).some(e => e.type === LazySharedCatalogManager)).toBe(false);
  expect(h.invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: expect.arrayContaining([input]), exact: true }));
});

it("only the explicit full-management action replaces the list", () => {
  const action = elements(renderList()).find(e => e.type === "button" && e.props["aria-label"] === "完整管理／新增商品")!;
  (action.props.onClick as () => void)();
  expect(elements(renderList()).some(e => e.props.id === "catalog-heading")).toBe(false);
});

it("a product removed since the list was loaded returns to the same list after acknowledging the error", () => {
  const close = vi.fn();
  const tree = SharedCatalogManager({ ...managerProps, initialCatalog: { ...managerProps.initialCatalog, products: [] }, onProductEditorClose: close });
  const feedback = elements(tree).find(e => e.props.message === "商品已變更，請返回清單重新整理。")!;
  expect(feedback.props.kind).toBe("error");
  (feedback.props.onClose as () => void)();
  expect(close).toHaveBeenCalledOnce();
});

it("the reused product dialog closes to the list on cancel and successful save, but not failed save", async () => {
  for (const action of ["cancel", "success", "failure"] as const) {
    h.states = []; h.cursor = 0;
    const close = vi.fn();
    const tree = SharedCatalogManager({ ...managerProps, onProductEditorClose: close });
    expect(elements(tree).some(e => e.props["data-testid"] === "shared-catalog-actions")).toBe(false);
    const editor = elements(tree).find(e => e.props.title === "編輯商品")!;
    if (action === "cancel") (editor.props.onClose as () => void)();
    else {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(action === "success" ? { catalog: managerProps.initialCatalog } : { error: "請修正內容" }, { status: action === "success" ? 200 : 400 })));
      const form = elements(editor).find(e => e.type === "form")!;
      await (form.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });
    }
    expect(close).toHaveBeenCalledTimes(action === "failure" ? 0 : 1);
  }
  vi.unstubAllGlobals();
});
