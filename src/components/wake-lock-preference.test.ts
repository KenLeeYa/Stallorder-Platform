import { describe, expect, it } from "vitest";
import {
  readWakeLockPreference,
  WAKE_LOCK_PREFERENCE_KEY,
  writeWakeLockPreference,
} from "@/components/wake-lock-preference";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("wake lock preference", () => {
  it("remembers an enabled choice across page remounts", () => {
    const storage = memoryStorage();
    expect(readWakeLockPreference(storage)).toBe(false);
    writeWakeLockPreference(storage, true);
    expect(storage.getItem(WAKE_LOCK_PREFERENCE_KEY)).toBe("true");
    expect(readWakeLockPreference(storage)).toBe(true);
  });

  it("remembers when the operator turns the feature off", () => {
    const storage = memoryStorage();
    writeWakeLockPreference(storage, true);
    writeWakeLockPreference(storage, false);
    expect(readWakeLockPreference(storage)).toBe(false);
  });
});
