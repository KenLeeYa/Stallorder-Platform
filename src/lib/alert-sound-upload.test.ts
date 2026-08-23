import { describe, expect, it } from "vitest";
import { hasExpectedAlertSoundSignature } from "./alert-sound-upload";

describe("alert sound upload signatures", () => {
  it("accepts MP3, WAV and M4A headers", () => {
    expect(hasExpectedAlertSoundSignature(new Uint8Array([0x49, 0x44, 0x33]), "audio/mpeg")).toBe(true);
    expect(hasExpectedAlertSoundSignature(new TextEncoder().encode("RIFF1234WAVE"), "audio/wav")).toBe(true);
    expect(hasExpectedAlertSoundSignature(new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]), "audio/mp4")).toBe(true);
  });

  it("rejects MIME spoofing", () => {
    expect(hasExpectedAlertSoundSignature(new TextEncoder().encode("<script>"), "audio/mpeg")).toBe(false);
  });
});
