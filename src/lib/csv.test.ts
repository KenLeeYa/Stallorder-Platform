import { describe, expect, it } from "vitest";
import { createCsv, csvCell } from "./csv";

describe("CSV 安全輸出", () => {
  it("正確跳脫逗號、引號與換行", () => {
    expect(csvCell('一號攤,"主店"\n')).toBe('"一號攤,""主店""\n"');
  });

  it("阻擋試算表公式注入", () => {
    expect(csvCell(" =HYPERLINK(\"https://example.test\")")).toBe(
      '"\' =HYPERLINK(""https://example.test"")"',
    );
    expect(csvCell(299)).toBe('"299"');
  });

  it("以 CRLF 組合多列資料", () => {
    expect(createCsv([["攤位", "金額"], ["主店", 299]])).toBe(
      '"攤位","金額"\r\n"主店","299"',
    );
  });
});
