import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { StaffOrderComposer } from "@/components/staff-order-composer";

describe("StaffOrderComposer mobile toolbar", () => {
  it("keeps all five mobile actions in one icon-only row and hides explanatory copy", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <StaffOrderComposer
          stall={{
            id: "11111111-1111-4111-8111-111111111111",
            organizationId: "22222222-2222-4222-8222-222222222222",
            slug: "demo",
            currency: "TWD",
            timezone: "Asia/Taipei",
          }}
          catalog={{
            products: [],
            tables: [],
            fulfillmentSlots: [],
            limits: {
              maxItemQuantity: 100,
              maxUniqueProducts: 100,
              maxTotalQuantity: 100,
              maxNoteLength: 1000,
            },
          }}
          account={{ role: "STAFF" }}
          modules={{
            dineIn: true,
            delivery: true,
            print: false,
            payment: false,
            discount: false,
            discountApprovalThresholdBps: 8000,
          }}
          paymentOptions={[]}
          discountOptions={[]}
          onCreated={() => undefined}
          onClose={() => undefined}
        />
      </LocaleProvider>,
    );

    expect(html).toContain('data-testid="staff-composer-mobile-toolbar"');
    expect(html).toContain("grid-cols-5");
    expect(html).toContain('data-testid="staff-save-draft"');
    expect(html).toContain('data-testid="staff-open-drafts"');
    expect(html).toContain('data-testid="staff-order-menu-tab"');
    expect(html).toContain('data-testid="staff-order-cart-tab"');
    expect(html).toContain('class="mt-1 hidden text-sm text-stone-600 md:block"');
    expect(html).toContain('class="hidden border-t border-stone-100 pt-3 md:block"');
    expect(html).toContain("sr-only md:not-sr-only");
  });
});
