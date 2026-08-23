export const MAX_ALERT_SOUND_BYTES = 1024 * 1024;
export const MAX_ALERT_SOUND_DURATION_SECONDS = 8;

export type SupportedAlertSoundMime = "audio/mpeg" | "audio/wav" | "audio/x-wav" | "audio/mp4" | "audio/x-m4a";

export function alertSoundExtension(mime: SupportedAlertSoundMime) {
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "audio/wav" || mime === "audio/x-wav") return "wav";
  return "m4a";
}

export function hasExpectedAlertSoundSignature(bytes: Uint8Array, mime: SupportedAlertSoundMime) {
  if (mime === "audio/mpeg") {
    return ascii(bytes, 0, 3) === "ID3"
      || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  }
  if (mime === "audio/wav" || mime === "audio/x-wav") {
    return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE";
  }
  return bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp";
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}
