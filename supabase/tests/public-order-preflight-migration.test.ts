import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  fileURLToPath(new URL(
    "../migrations/20260813020000_canonical_public_order_preflight.sql",
    import.meta.url,
  )),
  "utf8",
);
const edgeSessionSource = readFileSync(
  fileURLToPath(new URL("../functions/create-order-session/index.ts", import.meta.url)),
  "utf8",
);
const edgeOrderSource = readFileSync(
  fileURLToPath(new URL("../functions/create-public-order/index.ts", import.meta.url)),
  "utf8",
);
const circuitBSource = readFileSync(
  fileURLToPath(new URL("../../src/server/public-order/circuit-b-service.ts", import.meta.url)),
  "utf8",
);
const repositorySource = readFileSync(
  fileURLToPath(new URL("../../src/server/public-order/trusted-rpc-repository.ts", import.meta.url)),
  "utf8",
);

describe("canonical public-order preflight migration", () => {
  it("exposes one service-role-only trusted RPC for session and order preflight", () => {
    expect(migrationSource).toMatch(
      /create(?: or replace)? function public\.public_order_preflight\(/,
    );
    expect(migrationSource).toContain("security definer");
    expect(migrationSource).toContain("set search_path = ''");
    expect(migrationSource).toContain(
      "revoke all on function public.public_order_preflight(",
    );
    expect(migrationSource).toContain(
      "grant execute on function public.public_order_preflight(",
    );
    expect(migrationSource).toContain("to service_role");
  });

  it("owns the canonical QR, ordering-mode, schedule, capacity, and replay checks", () => {
    expect(migrationSource).toContain("public.validate_ordering_schedule_context(");
    expect(migrationSource).toContain("public.calculate_stall_capacity(");
    expect(migrationSource).toContain("public.lookup_resumable_public_order(");
    expect(migrationSource).toContain("public.lookup_resumable_public_delivery_order(");
    expect(migrationSource).toContain("'ORDER_MODE_CONFLICT'");
    expect(migrationSource).toContain("'TABLE_UNAVAILABLE'");
    expect(migrationSource).toContain("'DELIVERY_UNAVAILABLE'");
    expect(migrationSource).toContain("'idempotent_order'");
    expect(migrationSource).toContain("'pickup_code_length', order_record.pickup_code_length");
  });

  it("keeps deployment and rate-limit gates outside the canonical preflight", () => {
    expect(migrationSource).not.toContain("check_public_order_intake_availability(");
    expect(migrationSource).not.toContain("check_global_public_request_gate(");
    expect(migrationSource).not.toContain("check_public_order_submission_gate(");
  });

  it("routes both Edge handlers and Circuit B through the same RPC contract", () => {
    expect(edgeSessionSource).toMatch(/admin\.rpc\(\s*"public_order_preflight"/);
    expect(edgeOrderSource).toMatch(/admin\.rpc\(\s*"public_order_preflight"/);
    expect(repositorySource).toContain("select public.public_order_preflight(");
    expect(circuitBSource.match(/preflightPublicOrder\(/g)).toHaveLength(2);

    expect(edgeSessionSource).not.toContain('"lookup_resumable_public_order"');
    expect(edgeSessionSource).not.toContain('"lookup_resumable_public_delivery_order"');
    expect(edgeOrderSource).not.toContain('.select("ordering_mode")');
    expect(edgeOrderSource).not.toContain('"lookup_public_order_idempotency"');
    expect(circuitBSource).not.toContain("lookupResumablePublicOrder(");
    expect(circuitBSource).not.toContain("lookupPublicOrderIdempotency(");
  });
});
