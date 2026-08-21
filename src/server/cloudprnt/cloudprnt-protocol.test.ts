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

beforeEach(() => {
  process.env.CLOUDPRNT_POC_BASIC_USERNAME = "mcp31lb";
  process.env.CLOUDPRNT_POC_BASIC_PASSWORD = "a-strong-test-password";
});

afterEach(() => {
  if (originalUsername === undefined) delete process.env.CLOUDPRNT_POC_BASIC_USERNAME;
  else process.env.CLOUDPRNT_POC_BASIC_USERNAME = originalUsername;
  if (originalPassword === undefined) delete process.env.CLOUDPRNT_POC_BASIC_PASSWORD;
  else process.env.CLOUDPRNT_POC_BASIC_PASSWORD = originalPassword;
});

describe("CloudPRNT protocol helpers", () => {
  it("requires configured HTTPS basic credentials", () => {
    const authorized = request({ authorization: basic("mcp31lb", "a-strong-test-password") });
    const rejected = request({ authorization: basic("mcp31lb", "wrong-password-value") });

    expect(cloudPrntAuthState(authorized)).toBe("AUTHORIZED");
    expect(cloudPrntAuthState(rejected)).toBe("UNAUTHORIZED");
    delete process.env.CLOUDPRNT_POC_BASIC_PASSWORD;
    expect(cloudPrntAuthState(authorized)).toBe("NOT_CONFIGURED");
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
      mediaTypes: ["text/plain"],
      jobToken: "55555555-5555-4555-8555-555555555555",
      deleteMethod: "DELETE",
    });
    expect(cloudPrntPollResponse(null)).toEqual({ jobReady: false });
  });

  it("accepts Star token headers and text media query parameters", () => {
    const tokenRequest = new Request("https://example.test/cloudprnt?type=text%2Fplain%3Bencoding%3Dutf-8", {
      headers: { "x-star-token": "job-1" },
    });
    expect(cloudPrntJobToken(tokenRequest)).toBe("job-1");
    expect(cloudPrntRequestedMediaType(tokenRequest)).toBe("text/plain");
  });
});

function request(headers: Record<string, string>) {
  return new Request("https://example.test/cloudprnt", { headers });
}

function basic(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}
