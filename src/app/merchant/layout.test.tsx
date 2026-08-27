import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { useOperationsLocale } from "@/components/operations-locale";
import MerchantLayout from "./layout";

vi.mock("@/lib/app-locale-server", () => ({
  getRequestAppLocale: vi.fn(async () => ({ locale: "zh-TW", hasLocaleCookie: true })),
}));

function OperationsLocaleProbe() {
  const { locale } = useOperationsLocale();
  return <span>{locale}</span>;
}

describe("MerchantLayout", () => {
  it("provides operations messages to the shared merchant header controls", async () => {
    const layout = await MerchantLayout({ children: <OperationsLocaleProbe /> });

    expect(renderToString(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        {layout}
      </LocaleProvider>,
    )).toContain("zh-TW");
  });
});
