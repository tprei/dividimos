import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountLocalWipeError, deleteAccount } from "./account-deletion";
import { DRAFT_INTENT_KEY } from "@/lib/draft-intent";

const fetchMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("./client", () => ({
  getSupabase: () => ({
    auth: {
      getSession: () => getSessionMock(),
    },
  }),
}));

const completeMock = vi.fn<(userId: string) => Promise<{ ok: true }>>();

vi.mock("./auth", () => ({
  completeAccountDeletionSignOut: (userId: string) => completeMock(userId),
  clearAccountDeletionMarker: vi.fn(),
}));

const removeAccountDraft = vi.fn();
const removeConfirmationPreferences = vi.fn();
const removeOnboardingTour = vi.fn();
const removeNativePushConsent = vi.fn();
const revokeAiConsent = vi.fn();
const clearStorage = vi.fn(async () => {});

vi.mock("@/lib/bill-draft-isolation", () => ({
  removeAccountDraft: (...args: unknown[]) => removeAccountDraft(...(args as [string])),
}));
vi.mock("@/lib/confirmation-preferences", () => ({
  removeConfirmationPreferences: (...args: unknown[]) =>
    removeConfirmationPreferences(...(args as [string])),
}));
vi.mock("@/hooks/use-onboarding-tour", () => ({
  removeOnboardingTour: (...args: unknown[]) => removeOnboardingTour(...(args as [string])),
}));
vi.mock("@/lib/push/native-consent", () => ({
  removeNativePushConsent: (...args: unknown[]) => removeNativePushConsent(...(args as [string])),
}));
vi.mock("@/lib/ai-consent", () => ({
  revokeAiConsent: (...args: unknown[]) => revokeAiConsent(...(args as [string])),
}));

vi.mock("@/stores/app-store", () => ({
  useAppStore: {
    persist: {
      clearStorage: (...args: unknown[]) => clearStorage(...(args as [])),
    },
  },
}));

const appleAvailable = vi.fn(() => false);
const reauthorizeApple = vi.fn();
vi.mock("@/lib/capacitor/auth", () => ({
  isAppleSignInAvailable: () => appleAvailable(),
  reauthorizeApple: () => reauthorizeApple(),
}));

const registerAppleCredential = vi.fn<(code: string) => Promise<void>>();
vi.mock("./apple-credential", () => ({
  registerAppleCredential: (code: string) => registerAppleCredential(code),
}));

function appleRefusalBody() {
  return {
    ok: false,
    status: 409,
    json: async () => ({ ok: false, code: "apple_reauthorization_required" }),
  } as Response;
}

function successBody(userId: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, userId }),
  } as Response;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(successBody("0a000000-0000-4000-8000-00000000000a"));
  getSessionMock.mockResolvedValue({ data: { session: { user: { id: "0a000000-0000-4000-8000-00000000000a" } } } });
  completeMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("deleteAccount with a linked Apple ID", () => {
  it("collects a fresh Apple authorization in the iOS app and retries once", async () => {
    appleAvailable.mockReturnValue(true);
    reauthorizeApple.mockResolvedValue({ status: "authorized", authorizationCode: "fresh-code" });
    registerAppleCredential.mockResolvedValue(undefined);
    fetchMock
      .mockResolvedValueOnce(appleRefusalBody())
      .mockResolvedValueOnce(successBody("0a000000-0000-4000-8000-00000000000a"));

    const result = await deleteAccount();

    expect(result).toEqual({ ok: true, userId: "0a000000-0000-4000-8000-00000000000a" });
    expect(registerAppleCredential).toHaveBeenCalledWith("fresh-code");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the refusal without deleting when the Apple sheet is cancelled", async () => {
    appleAvailable.mockReturnValue(true);
    reauthorizeApple.mockResolvedValue({ status: "cancelled" });
    fetchMock.mockResolvedValueOnce(appleRefusalBody());

    expect(await deleteAccount()).toEqual({ ok: false, code: "apple_reauthorization_required" });
    expect(registerAppleCredential).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("returns the refusal outside the iOS app without opening any sheet", async () => {
    appleAvailable.mockReturnValue(false);
    fetchMock.mockResolvedValueOnce(appleRefusalBody());

    expect(await deleteAccount()).toEqual({ ok: false, code: "apple_reauthorization_required" });
    expect(reauthorizeApple).not.toHaveBeenCalled();
  });
});

describe("deleteAccount", () => {
  it("wipes the matching account after a successful response", async () => {
    await deleteAccount();

    expect(fetchMock).toHaveBeenCalledWith("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "EXCLUIR" }),
    });
    expect(completeMock).toHaveBeenCalledWith("0a000000-0000-4000-8000-00000000000a");
    expect(removeAccountDraft).toHaveBeenCalledWith("0a000000-0000-4000-8000-00000000000a");
    expect(removeConfirmationPreferences).toHaveBeenCalledWith("0a000000-0000-4000-8000-00000000000a");
    expect(removeOnboardingTour).toHaveBeenCalledWith("0a000000-0000-4000-8000-00000000000a");
    expect(removeNativePushConsent).toHaveBeenCalledWith("0a000000-0000-4000-8000-00000000000a");
    expect(revokeAiConsent).toHaveBeenCalledWith("0a000000-0000-4000-8000-00000000000a");
    expect(clearStorage).toHaveBeenCalled();
  });

  it("never wipes account B when a late ack names account A", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "0b000000-0000-4000-8000-00000000000b" } } } });

    const result = await deleteAccount();

    expect(result).toEqual({ ok: false, code: "deletion_failed", retryable: true });
    expect(completeMock).not.toHaveBeenCalled();
    expect(removeAccountDraft).not.toHaveBeenCalled();
    expect(clearStorage).not.toHaveBeenCalled();
  });

  it("runs every cleanup and local sign-out and still reports a partial wipe", async () => {
    removeAccountDraft.mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    await expect(deleteAccount()).rejects.toBeInstanceOf(AccountLocalWipeError);

    expect(completeMock).toHaveBeenCalledWith("0a000000-0000-4000-8000-00000000000a");
    expect(removeConfirmationPreferences).toHaveBeenCalledWith("0a000000-0000-4000-8000-00000000000a");
    expect(removeOnboardingTour).toHaveBeenCalledWith("0a000000-0000-4000-8000-00000000000a");
    expect(removeNativePushConsent).toHaveBeenCalledWith("0a000000-0000-4000-8000-00000000000a");
    expect(clearStorage).toHaveBeenCalled();
  });

  it("keeps the deletion_failed result when the response does not decode", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: "world" }),
    } as Response);

    await expect(deleteAccount()).resolves.toEqual({
      ok: false,
      code: "deletion_failed",
      retryable: true,
    });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("clears the bill draft intent and cached guest claim tokens from the device", async () => {
    window.localStorage.setItem(DRAFT_INTENT_KEY, JSON.stringify({ kind: "new" }));
    window.localStorage.setItem("dividimos:claim-token:guest-1", JSON.stringify({ token: "gst1_abc", expiresAt: "2099-01-01T00:00:00.000Z" }));
    window.localStorage.setItem("dividimos-theme", "dark");

    await deleteAccount();

    expect(window.localStorage.getItem(DRAFT_INTENT_KEY)).toBeNull();
    expect(window.localStorage.getItem("dividimos:claim-token:guest-1")).toBeNull();
    expect(window.localStorage.getItem("dividimos-theme")).toBe("dark");
  });
});
