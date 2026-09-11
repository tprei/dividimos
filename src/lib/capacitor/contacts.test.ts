import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPlatform = vi.fn(() => "android");
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => mockGetPlatform() },
}));

type StateListener = (state: { isActive: boolean }) => void;
let stateListener: StateListener | null = null;
const mockRemove = vi.fn().mockResolvedValue(undefined);
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (_event: string, handler: StateListener) => {
      stateListener = handler;
      return Promise.resolve({ remove: mockRemove });
    },
  },
}));

const mockCheckPermissions = vi.fn();
const mockRequestPermissions = vi.fn();
const mockPickContact = vi.fn();
vi.mock("@capacitor-community/contacts", () => ({
  Contacts: {
    checkPermissions: () => mockCheckPermissions(),
    requestPermissions: () => mockRequestPermissions(),
    pickContact: (...args: unknown[]) => mockPickContact(...args),
  },
}));

import { pickNativeContact } from "./contacts";

describe("pickNativeContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateListener = null;
    mockCheckPermissions.mockResolvedValue({ contacts: "granted" });
    mockRequestPermissions.mockResolvedValue({ contacts: "granted" });
  });

  it("returns the picked contact's name and phone", async () => {
    mockPickContact.mockResolvedValue({
      contact: {
        name: { display: "Maria Silva" },
        phones: [{ number: "+5511999999999" }],
      },
    });

    await expect(pickNativeContact()).resolves.toEqual({
      status: "ok",
      name: "Maria Silva",
      phone: "+5511999999999",
    });
  });

  it("settles as cancelled when the user backs out of the picker", async () => {
    // The Android picker never settles this promise on back.
    mockPickContact.mockReturnValue(new Promise(() => {}));

    const pending = pickNativeContact();
    await vi.waitFor(() => expect(stateListener).not.toBeNull());
    stateListener!({ isActive: true });

    await expect(pending).resolves.toEqual({ status: "cancelled" });
    expect(mockRemove).toHaveBeenCalled();
  });

  it("reports a refused permission without opening the picker", async () => {
    mockCheckPermissions.mockResolvedValue({ contacts: "denied" });
    mockRequestPermissions.mockResolvedValue({ contacts: "denied" });

    await expect(pickNativeContact()).resolves.toEqual({ status: "permission_denied" });
    expect(mockPickContact).not.toHaveBeenCalled();
  });

  it("reports a permission check that throws as an error, not a crash", async () => {
    mockCheckPermissions.mockRejectedValue(new Error("plugin unavailable"));

    const result = await pickNativeContact();
    expect(result.status).toBe("error");
  });
});
