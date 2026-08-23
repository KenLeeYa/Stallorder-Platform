import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const editSource = readFileSync(
  fileURLToPath(new URL("./public-order-edit.ts", import.meta.url)),
  "utf8",
);
const printSchemaSource = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20260716000300_p1_operational_tools.sql", import.meta.url)),
  "utf8",
);

describe("public order edit print queue contract", () => {
  it("removes only unstarted jobs so reconfirmation can enqueue the revised ticket", () => {
    expect(printSchemaSource).toMatch(
      /unique index if not exists print_jobs_initial_order_unique\s+on public\.print_jobs \(order_id\) where reprint_of_id is null/,
    );
    expect(editSource).toMatch(
      /printJob\.deleteMany\(\{\s*where: \{ orderId: order\.id, status: "PENDING" \}/,
    );
    expect(editSource).not.toMatch(
      /printJob\.updateMany\([\s\S]*PUBLIC_ORDER_EDITED_BEFORE_PRODUCTION/,
    );
  });
});
