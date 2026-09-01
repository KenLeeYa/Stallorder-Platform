export const WAKE_LOCK_PREFERENCE_KEY = "stallorder:pwa:wake-lock-requested:v1";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readWakeLockPreference(storage: PreferenceStorage) {
  try {
    return storage.getItem(WAKE_LOCK_PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeWakeLockPreference(storage: PreferenceStorage, enabled: boolean) {
  try {
    storage.setItem(WAKE_LOCK_PREFERENCE_KEY, String(enabled));
  } catch {
    // Keep the current session working when browser storage is unavailable.
  }
}
