import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { plugin } = vi.hoisted(() => ({
  plugin: {
    failImport: false,
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    pickContact: vi.fn(),
  },
}));

vi.mock("@capacitor-community/contacts", () => {
  if (plugin.failImport) throw new Error("Plugin not implemented on android");
  return { Contacts: plugin };
});

beforeEach(() => {
  plugin.failImport = false;
  plugin.checkPermissions.mockResolvedValue({ contacts: "granted" });
  plugin.requestPermissions.mockResolvedValue({ contacts: "granted" });
  plugin.pickContact.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

// Re-imported per test: `pickNativeContact` loads the plugin through a dynamic
// import, so each case needs a module registry that was reset first.
async function loadPickNativeContact() {
  const mod = await import("./contacts");
  return mod.pickNativeContact;
}

describe("pickNativeContact", () => {
  it("returns an error result when the plugin module fails to load", async () => {
    plugin.failImport = true;

    const pickNativeContact = await loadPickNativeContact();
    const result = await pickNativeContact();

    if (result.status !== "error") {
      throw new Error(`expected error result, got ${result.status}`);
    }
    expect(result.error).toBeInstanceOf(Error);
  });

  it("returns permission_denied when the permission request is refused", async () => {
    plugin.checkPermissions.mockResolvedValue({ contacts: "prompt" });
    plugin.requestPermissions.mockResolvedValue({ contacts: "denied" });

    const pickNativeContact = await loadPickNativeContact();
    const result = await pickNativeContact();

    expect(result).toEqual({ status: "permission_denied" });
    expect(plugin.pickContact).not.toHaveBeenCalled();
  });

  it("returns cancelled when the native picker rejects with a cancellation", async () => {
    plugin.pickContact.mockRejectedValue(new Error("User cancelled contacts picker"));

    const pickNativeContact = await loadPickNativeContact();
    const result = await pickNativeContact();

    expect(result).toEqual({ status: "cancelled" });
  });

  it("returns cancelled when the native picker never settles", async () => {
    plugin.pickContact.mockReturnValue(Promise.withResolvers<never>().promise);

    const pickNativeContact = await loadPickNativeContact();
    vi.useFakeTimers();
    const pending = pickNativeContact();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(await pending).toEqual({ status: "cancelled" });
  });

  it("returns the picked contact display name and first phone", async () => {
    plugin.pickContact.mockResolvedValue({
      contact: {
        name: { display: "Bob Silva", given: "Bob", family: "Silva" },
        phones: [{ number: "+55 11 91234-5678" }, { number: "+55 11 99999-0000" }],
      },
    });

    const pickNativeContact = await loadPickNativeContact();
    const result = await pickNativeContact();

    expect(result).toEqual({
      status: "ok",
      name: "Bob Silva",
      phone: "+55 11 91234-5678",
    });
  });

  it("composes the name from given and family when there is no display name", async () => {
    plugin.pickContact.mockResolvedValue({
      contact: { name: { given: "Ana", family: "Lima" }, phones: [] },
    });

    const pickNativeContact = await loadPickNativeContact();
    const result = await pickNativeContact();

    expect(result).toEqual({ status: "ok", name: "Ana Lima", phone: null });
  });
});
