import { hash } from "bcryptjs";
import { describe, expect, it } from "vitest";
import { verifyPasswordCredential } from "./password-auth";

describe("密碼驗證", () => {
  it("僅接受帳號實際儲存的密碼雜湊", async () => {
    const passwordHash = await hash("correct horse battery staple", 4);

    await expect(verifyPasswordCredential("correct horse battery staple", passwordHash)).resolves.toBe(true);
    await expect(verifyPasswordCredential("wrong password", passwordHash)).resolves.toBe(false);
  });

  it("沒有密碼憑證時固定拒絕，但仍執行計時用比對", async () => {
    await expect(verifyPasswordCredential("any password", null)).resolves.toBe(false);
    await expect(verifyPasswordCredential("any password", undefined)).resolves.toBe(false);
  });
});
