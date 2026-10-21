import { expect, it } from "vitest";
import { assertPreviewOrderSession } from "./qa-preview-public-order";

const session = {
  orderSessionToken: `stos_${"a".repeat(43)}`,
  expiresAt: "2099-01-01T00:00:00.000Z",
  orderingMode: "DEFAULT",
};

it("accepts the documented idempotent HTTP 200 session after a client retry", () => {
  expect(() => assertPreviewOrderSession(200, session)).not.toThrow();
});

it("accepts a new HTTP 201 session but never errors, expired sessions or order-resume responses", () => {
  expect(() => assertPreviewOrderSession(201, session)).not.toThrow();
  for (const [status, body] of [
    [500, session], [403, session], [200, null], [200, { error: "unavailable" }],
    [200, { trackingToken: "sto_example", orderingMode: "DEFAULT" }],
    [200, { ...session, expiresAt: "2020-01-01T00:00:00.000Z" }],
    [201, { ...session, orderSessionToken: "invalid" }],
    [201, { ...session, orderingMode: "DELIVERY" }],
  ] as const) expect(() => assertPreviewOrderSession(status, body)).toThrow();
});
