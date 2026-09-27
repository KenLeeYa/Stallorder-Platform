import "server-only";
import QRCode from "qrcode";
import { pickupTokenPattern } from "./pickup-contract";

export function renderPickupPng(token: string) {
  if (!pickupTokenPattern.test(token)) throw new Error("PICKUP_TOKEN_INVALID");
  return QRCode.toBuffer(token, { type: "png", width: 512, margin: 4, errorCorrectionLevel: "M" });
}
