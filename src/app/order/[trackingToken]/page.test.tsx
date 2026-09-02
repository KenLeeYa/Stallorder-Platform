import { describe, expect, it } from "vitest";
import PublicOrderPage from "./page";

const trackingToken = `sto_${"t".repeat(48)}`;
const qrToken = "qr_abcdefghijklmnopqrstuvwxyz123456";

describe("public order page QR context", () => {
  it("passes a valid source QR token to the tracker", async () => {
    const element = await PublicOrderPage({
      params: Promise.resolve({ trackingToken }),
      searchParams: Promise.resolve({ qr: qrToken }),
    });

    expect(element.props).toMatchObject({ trackingToken, qrToken });
  });

  it("does not expose an invalid QR context to return navigation", async () => {
    const element = await PublicOrderPage({
      params: Promise.resolve({ trackingToken }),
      searchParams: Promise.resolve({ qr: "too-short" }),
    });

    expect(element.props).toMatchObject({ trackingToken, qrToken: null });
  });
});
