import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickNativeContact } from "./contacts";

interface ContactsPlugin {
  checkPermissions: () => Promise<{ contacts: string }>;
  requestPermissions?: () => Promise<{ contacts: string }>;
  pickContact?: () => Promise<unknown>;
}

const plugin: { impl: ContactsPlugin | null } = { impl: null };

// A hoisted mock with a mutable implementation, because vi.doMock plus
// resetModules between tests loses races against the dynamic import inside
// pickNativeContact and leaks one test's plugin into the next.
vi.mock("@capacitor-community/contacts", () => ({
  get Contacts(): ContactsPlugin {
    if (!plugin.impl) throw new Error("Plugin not implemented on android");
    return plugin.impl;
  },
}));

describe("pickNativeContact", () => {
  beforeEach(() => {
    plugin.impl = null;
  });

  it("returns an error result when the plugin is unavailable", async () => {
    const result = await pickNativeContact();

    if (result.status !== "error") {
      throw new Error(`expected error result, got ${result.status}`);
    }
    expect(result.error).toBeInstanceOf(Error);
  });

  it("returns permission_denied when the permission request is refused", async () => {
    plugin.impl = {
      checkPermissions: async () => ({ contacts: "prompt" }),
      requestPermissions: async () => ({ contacts: "denied" }),
    };

    await expect(pickNativeContact()).resolves.toEqual({ status: "permission_denied" });
  });

  it("returns cancelled when the native picker rejects with a cancellation", async () => {
    plugin.impl = {
      checkPermissions: async () => ({ contacts: "granted" }),
      pickContact: async () => {
        throw new Error("User cancelled contacts picker");
      },
    };

    await expect(pickNativeContact()).resolves.toEqual({ status: "cancelled" });
  });

  it("returns the picked contact display name and first phone", async () => {
    plugin.impl = {
      checkPermissions: async () => ({ contacts: "granted" }),
      pickContact: async () => ({
        contact: {
          name: { display: "Bob Silva", given: "Bob", family: "Silva" },
          phones: [{ number: "+55 11 91234-5678" }, { number: "+55 11 99999-0000" }],
        },
      }),
    };

    await expect(pickNativeContact()).resolves.toEqual({
      status: "ok",
      name: "Bob Silva",
      phone: "+55 11 91234-5678",
    });
  });
});
