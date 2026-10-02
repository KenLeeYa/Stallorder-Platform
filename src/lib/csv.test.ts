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
  it("blocks formulas after LF or leading controls without changing numeric negatives", () => {
    for (const prefix of ["\n", "\u0000", "\u000b\t\r "]) {
      for (const formula of ["=1", "+1", "-1", "@SUM(A1)"]) expect(csvCell(prefix + formula)).toBe(`"'${prefix}${formula}"`);
    }
    expect(csvCell(-50)).toBe('"-50"');
    expect(csvCell("正常商品\n第二行")).toBe('"正常商品\n第二行"');
  });
});
