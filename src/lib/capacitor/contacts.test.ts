import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@capacitor-community/contacts");
  vi.resetModules();
});

async function loadPickNativeContact() {
  const mod = await import("./contacts");
  return mod.pickNativeContact;
}

describe("pickNativeContact", () => {
  it("returns an error result when the plugin module fails to load", async () => {
    vi.doMock("@capacitor-community/contacts", () => {
      throw new Error("Plugin not implemented on android");
    });

    const pickNativeContact = await loadPickNativeContact();
    const result = await pickNativeContact();

    if (result.status !== "error") {
      throw new Error(`expected error result, got ${result.status}`);
    }
    expect(result.error).toBeInstanceOf(Error);
  });

  it("returns permission_denied when the permission request is refused", async () => {
    vi.doMock("@capacitor-community/contacts", () => ({
      Contacts: {
        checkPermissions: async () => ({ contacts: "prompt" }),
        requestPermissions: async () => ({ contacts: "denied" }),
      },
    }));

    const pickNativeContact = await loadPickNativeContact();
    const result = await pickNativeContact();

    expect(result).toEqual({ status: "permission_denied" });
  });

  it("returns cancelled when the native picker rejects with a cancellation", async () => {
    vi.doMock("@capacitor-community/contacts", () => ({
      Contacts: {
        checkPermissions: async () => ({ contacts: "granted" }),
        pickContact: async () => {
          throw new Error("User cancelled contacts picker");
        },
      },
    }));

    const pickNativeContact = await loadPickNativeContact();
    const result = await pickNativeContact();

    expect(result).toEqual({ status: "cancelled" });
  });

  it("returns the picked contact display name and first phone", async () => {
    vi.doMock("@capacitor-community/contacts", () => ({
      Contacts: {
        checkPermissions: async () => ({ contacts: "granted" }),
        pickContact: async () => ({
          contact: {
            name: { display: "Bob Silva", given: "Bob", family: "Silva" },
            phones: [{ number: "+55 11 91234-5678" }, { number: "+55 11 99999-0000" }],
          },
        }),
      },
    }));

    const pickNativeContact = await loadPickNativeContact();
    const result = await pickNativeContact();

    expect(result).toEqual({
      status: "ok",
      name: "Bob Silva",
      phone: "+55 11 91234-5678",
    });
  });
});
