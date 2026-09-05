import { describe, expect, it } from "vitest";
import {
  persistTakeoutCustomerMemory,
  readTakeoutCustomerMemory,
} from "./takeout-customer-memory";

describe("takeout customer memory", () => {
  it("retains only the customer name and phone for the same stall", () => {
    const storage = memoryStorage();
    persistTakeoutCustomerMemory(storage, "aming-chicken", {
      customerName: " 王小姐 ",
      customerPhone: " 0912345678 ",
    }, 1_000);

    expect(readTakeoutCustomerMemory(storage, "aming-chicken", 2_000)).toEqual({
      customerName: "王小姐",
      customerPhone: "0912345678",
      expiresAt: 1_000 + 180 * 24 * 60 * 60 * 1_000,
    });
    expect(readTakeoutCustomerMemory(storage, "another-stall", 2_000)).toBeNull();
  });

  it("removes expired customer identity", () => {
    const storage = memoryStorage();
    persistTakeoutCustomerMemory(storage, "aming-chicken", {
      customerName: "王小姐",
      customerPhone: "0912345678",
    }, 1_000);

    expect(readTakeoutCustomerMemory(
      storage,
      "aming-chicken",
      1_000 + 180 * 24 * 60 * 60 * 1_000 + 1,
    )).toBeNull();
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}
