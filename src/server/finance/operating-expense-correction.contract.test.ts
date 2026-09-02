import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");
}

const serviceSource = read("./operating-profit-service.ts");
const contractSource = read("./operating-profit-contract.ts");
const routeSource = read("../../app/api/merchant/organizations/[organizationId]/operating-profit/route.ts");
const dashboardSource = read("../../components/operating-profit-dashboard.tsx");
const schemaSource = read("../../../prisma/schema.prisma");
const migrationSource = read("../../../supabase/migrations/20260901190000_operating_expense_corrections.sql");

describe("operating expense correction audit contract", () => {
  it("voids the original and creates a linked replacement without deleting history", () => {
    expect(serviceSource).toContain('case "CORRECT_EXPENSE"');
    expect(serviceSource).toContain("voidedAt: new Date()");
    expect(serviceSource).toContain("correctsExpenseId: original.id");
    expect(serviceSource).toContain("voidedAt: null");
    expect(serviceSource).not.toContain("operatingExpense.delete(");
  });

  it("requires a reason and records a correction audit event", () => {
    expect(contractSource).toContain('operation: z.literal("CORRECT_EXPENSE")');
    expect(contractSource).toContain("correctionReason:");
    expect(routeSource).toContain("OPERATING_EXPENSE_CORRECTED");
    expect(routeSource).toContain("correctionReason");
  });

  it("offers a touch-friendly correction overlay for posted expenses", () => {
    expect(dashboardSource).toContain("openExpenseCorrection");
    expect(dashboardSource).toContain('data-testid="operating-expense-correction-dialog"');
    expect(dashboardSource).toContain('name="correctionReason"');
    expect(dashboardSource).toContain("原紀錄會保留");
  });

  it("adds correction lineage and void metadata to the database", () => {
    expect(schemaSource).toContain("correctsExpenseId");
    expect(schemaSource).toContain("voidedAt");
    expect(schemaSource).toContain("voidReason");
    expect(migrationSource).toContain("corrects_expense_id");
    expect(migrationSource).toContain("voided_at");
    expect(migrationSource).toContain("void_reason");
  });
});
