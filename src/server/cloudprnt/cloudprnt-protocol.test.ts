import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cloudPrntAuthState,
  cloudPrntJobToken,
  cloudPrntPollResponse,
  cloudPrntRequestedMediaType,
  cloudPrntStatusSucceeded,
  decodeCloudPrntStatus,
} from "@/server/cloudprnt/cloudprnt-protocol";

const originalUsername = process.env.CLOUDPRNT_POC_BASIC_USERNAME;
const originalPassword = process.env.CLOUDPRNT_POC_BASIC_PASSWORD;
const originalEnabled = process.env.CLOUDPRNT_POC_ENABLED;
const originalPrinterId = process.env.CLOUDPRNT_POC_PRINTER_ID;
const printerId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  process.env.CLOUDPRNT_POC_ENABLED = "true";
  process.env.CLOUDPRNT_POC_PRINTER_ID = printerId;
  process.env.CLOUDPRNT_POC_BASIC_USERNAME = "mcp31lb";
  process.env.CLOUDPRNT_POC_BASIC_PASSWORD = "a-strong-test-password";
});

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.CLOUDPRNT_POC_ENABLED;
  else process.env.CLOUDPRNT_POC_ENABLED = originalEnabled;
  if (originalPrinterId === undefined) delete process.env.CLOUDPRNT_POC_PRINTER_ID;
  else process.env.CLOUDPRNT_POC_PRINTER_ID = originalPrinterId;
  if (originalUsername === undefined) delete process.env.CLOUDPRNT_POC_BASIC_USERNAME;
  else process.env.CLOUDPRNT_POC_BASIC_USERNAME = originalUsername;
  if (originalPassword === undefined) delete process.env.CLOUDPRNT_POC_BASIC_PASSWORD;
  else process.env.CLOUDPRNT_POC_BASIC_PASSWORD = originalPassword;
});

describe("CloudPRNT protocol helpers", () => {
  it("requires configured HTTPS basic credentials", () => {
    const authorized = request({ authorization: basic("mcp31lb", "a-strong-test-password") });
    const rejected = request({ authorization: basic("mcp31lb", "wrong-password-value") });

    expect(cloudPrntAuthState(authorized, printerId)).toBe("AUTHORIZED");
    expect(cloudPrntAuthState(rejected, printerId)).toBe("UNAUTHORIZED");
    expect(cloudPrntAuthState(authorized, "66666666-6666-4666-8666-666666666666")).toBe("UNAUTHORIZED");
    delete process.env.CLOUDPRNT_POC_BASIC_PASSWORD;
    expect(cloudPrntAuthState(authorized, printerId)).toBe("NOT_CONFIGURED");
  });

  it("stays disabled until the PoC and allowed printer are explicitly configured", () => {
    const authorized = request({ authorization: basic("mcp31lb", "a-strong-test-password") });

    process.env.CLOUDPRNT_POC_ENABLED = "false";
    expect(cloudPrntAuthState(authorized, printerId)).toBe("NOT_CONFIGURED");
    process.env.CLOUDPRNT_POC_ENABLED = "true";
    delete process.env.CLOUDPRNT_POC_PRINTER_ID;
    expect(cloudPrntAuthState(authorized, printerId)).toBe("NOT_CONFIGURED");
  });

  it("normalizes percent-encoded status and recognizes only successful completion codes", () => {
    expect(decodeCloudPrntStatus("200%20OK")).toBe("200 OK");
    expect(cloudPrntStatusSucceeded("200%20OK")).toBe(true);
    expect(cloudPrntStatusSucceeded("OK")).toBe(true);
    expect(cloudPrntStatusSucceeded("510%20Media%20Type%20Error")).toBe(false);
  });

  it("returns an immutable job token and supported media type in a ready poll", () => {
    expect(cloudPrntPollResponse("55555555-5555-4555-8555-555555555555")).toEqual({
      jobReady: true,
      mediaTypes: ["application/vnd.star.starprnt"],
      jobToken: "55555555-5555-4555-8555-555555555555",
      deleteMethod: "DELETE",
    });
    expect(cloudPrntPollResponse(null)).toEqual({ jobReady: false });
  });

  it("accepts Star token headers and native StarPRNT media query parameters", () => {
    const tokenRequest = new Request("https://example.test/cloudprnt?type=application%2Fvnd.star.starprnt", {
      headers: { "x-star-token": "job-1" },
    });
    expect(cloudPrntJobToken(tokenRequest)).toBe("job-1");
    expect(cloudPrntRequestedMediaType(tokenRequest)).toBe("application/vnd.star.starprnt");
  });
});

function request(headers: Record<string, string>) {
  return new Request("https://example.test/cloudprnt", { headers });
}

function basic(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}
