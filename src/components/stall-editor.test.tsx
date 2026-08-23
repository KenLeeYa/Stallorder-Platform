import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { StallEditor } from "./stall-editor";

const initial = {
  name: "測試攤位",
  code: "FIXED-CODE",
  slug: "test-stall",
  description: "",
  address: "台北市測試路 1 號",
  phone: "",
  timezone: "Asia/Taipei",
  currency: "TWD",
};

describe("stall editor code immutability", () => {
  it("renders an existing stall code read-only with a clear explanation", () => {
    const html = renderEditor(
      <StallEditor
        organizationId="11111111-1111-4111-8111-111111111111"
        stallId="22222222-2222-4222-8222-222222222222"
        initial={initial}
        section="basic"
      />,
    );

    expect(codeInput(html)).toContain('readOnly=""');
    expect(codeInput(html)).toContain('maxLength="50"');
    expect(html).toContain("為確保公開商店網址穩定，攤位建立後代碼即鎖定");
    expect(html).toContain("上傳文宣圖片");
  });

  it("keeps the code editable while creating a stall", () => {
    const html = renderEditor(
      <StallEditor
        organizationId="11111111-1111-4111-8111-111111111111"
        initial={initial}
        section="basic"
      />,
    );

    expect(codeInput(html)).not.toContain('readOnly=""');
    expect(html).not.toContain("攤位建立後代碼即鎖定");
    expect(html).not.toContain("上傳文宣圖片");
  });
});

function renderEditor(editor: React.ReactNode) {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>{editor}</LocaleProvider>,
  );
}

function codeInput(html: string) {
  return html.match(/<input[^>]*name="code"[^>]*>/)?.[0] ?? "";
}
