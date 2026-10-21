import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import {
  mobileSessionSchema,
  type MobileSession,
} from "@stallorder/contracts/mobile/v1";

const sessionKey = "stallorder.mobile.session.v1";
const legacySessionTokenKey = "stallorder.mobile.session-token.v1";
const deviceIdKey = "stallorder.mobile.device-id.v1";

let storageQueue:Promise<unknown>=Promise.resolve();
function storageTask<T>(task:()=>Promise<T>):Promise<T>{const next=storageQueue.catch(()=>undefined).then(task);storageQueue=next;return next;}
export function getStoredSession():Promise<MobileSession|null>{return storageTask(readSession);}
async function readSession(): Promise<MobileSession | null> {
  const stored = await SecureStore.getItemAsync(sessionKey);
  if (stored) {
    try {
      const parsed = mobileSessionSchema.safeParse(JSON.parse(stored));
      if (parsed.success) return parsed.data;
    } catch {
      // Invalid persisted JSON is cleared below.
    }
    await SecureStore.deleteItemAsync(sessionKey);
  }

  const legacyToken = await SecureStore.getItemAsync(legacySessionTokenKey);
  if (!legacyToken) return null;
  await SecureStore.deleteItemAsync(legacySessionTokenKey);
  return null;
}

export function setStoredSession(session:MobileSession){return storageTask(()=>writeSession(session));}
async function writeSession(session: MobileSession) {
  await SecureStore.setItemAsync(sessionKey, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.deleteItemAsync(legacySessionTokenKey);
}

export function clearStoredSession(){return storageTask(async()=>{await SecureStore.deleteItemAsync(sessionKey);await SecureStore.deleteItemAsync(legacySessionTokenKey);});}

let deviceFlight: Promise<string> | null = null;
export function getOrCreateDeviceId() {
  return deviceFlight ??= storageTask(createDeviceId).catch(error => { deviceFlight = null; throw error; });
}
async function createDeviceId() {
  const existing = await SecureStore.getItemAsync(deviceIdKey);
  if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) return existing;
  const deviceId = Crypto.randomUUID();
  await SecureStore.setItemAsync(deviceIdKey, deviceId, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return deviceId;
}
