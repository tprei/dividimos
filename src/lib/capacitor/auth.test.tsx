import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { getPendingSignInName, setPendingSignInName } from "@/lib/pending-sign-in-name";

const mockGetPlatform = vi.fn(() => "android");
const mockIsNativePlatform = vi.fn(() => true);
const mockInitialize = vi.fn();
const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockSignInWithIdToken = vi.fn();
const mockLinkIdentity = vi.fn();
const mockGetUserIdentities = vi.fn();
const mockAssign = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => mockGetPlatform(),
    isNativePlatform: () => mockIsNativePlatform(),
  },
}));

vi.mock("@capgo/capacitor-social-login", () => ({
  SocialLogin: {
    initialize: (...args: unknown[]) => mockInitialize(...args),
    login: (...args: unknown[]) => mockLogin(...args),
    logout: (...args: unknown[]) => mockLogout(...args),
  },
}));

const APPLE_CANCEL =
  "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)";
const APPLE_CANCEL_PT_BR =
  "Não foi possível concluir a operação. (com.apple.AuthenticationServices.AuthorizationError erro 1001.)";
const APPLE_FAILURE =
  "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1000.)";
const GOOGLE_IOS_CANCEL = "The user canceled the sign-in flow.";
const ANDROID_CANCEL = "Google Sign-In failed: activity is cancelled by the user.";

function makeSupabase() {
  return {
    auth: {
      signInWithIdToken: mockSignInWithIdToken,
      linkIdentity: mockLinkIdentity,
      getUserIdentities: mockGetUserIdentities,
    },
  };
}

function appleLogin(overrides: Record<string, unknown> = {}) {
  return {
    provider: "apple",
    result: {
      accessToken: null,
      idToken: "apple-id-token",
      profile: { user: "apple-sub", email: null, givenName: "", familyName: "" },
      authorizationCode: "apple-code",
      ...overrides,
    },
  };
}

function googleLogin(idToken: string | null = "google-id-token") {
  return {
    provider: "google",
    result: { responseType: "online", idToken, accessToken: null, profile: {} },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockIsNativePlatform.mockReturnValue(true);
  window.sessionStorage.clear();
  process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID = "ios-client-id.apps.googleusercontent.com";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID;
});

Object.defineProperty(window, "location", {
  value: {
    origin: "https://www.dividimos.ai",
    hash: "",
    assign: (...args: unknown[]) => mockAssign(...args),
  },
  writable: true,
});

// The module reads NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID and keeps plugin state at
// load time, so each test imports a fresh copy after vi.resetModules().
async function loadModule() {
  return import("./auth");
}

describe("provider availability", () => {
  it("offers Apple only inside the iOS app", async () => {
    const cases: [boolean, string, boolean][] = [
      [true, "ios", true],
      [true, "android", false],
      [false, "web", false],
    ];
    for (const [native, platform, expected] of cases) {
      mockIsNativePlatform.mockReturnValue(native);
      mockGetPlatform.mockReturnValue(platform);
      const { isAppleSignInAvailable } = await loadModule();
      expect(isAppleSignInAvailable()).toBe(expected);
    }
  });

  it("offers native Google on iOS only when the iOS client id is configured", async () => {
    mockGetPlatform.mockReturnValue("ios");
    expect((await loadModule()).isNativeGoogleSignInAvailable()).toBe(true);

    vi.resetModules();
    process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID = "";
    expect((await loadModule()).isNativeGoogleSignInAvailable()).toBe(false);

    mockGetPlatform.mockReturnValue("android");
    expect((await loadModule()).isNativeGoogleSignInAvailable()).toBe(true);

    mockIsNativePlatform.mockReturnValue(false);
    mockGetPlatform.mockReturnValue("web");
    expect((await loadModule()).isNativeGoogleSignInAvailable()).toBe(false);
  });

  it("reports unavailable without opening a sheet", async () => {
    mockGetPlatform.mockReturnValue("android");
    const { appleSignIn } = await loadModule();

    expect(await appleSignIn(makeSupabase() as never)).toEqual({ status: "failed", reason: "unavailable" });
    expect(mockLogin).not.toHaveBeenCalled();
  });
});

describe("appleSignIn", () => {
  beforeEach(() => {
    mockGetPlatform.mockReturnValue("ios");
  });

  it("sends Apple sha256(nonce) and Supabase the raw nonce, returning the authorization code", async () => {
    mockLogin.mockResolvedValue(appleLogin());
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    const { appleSignIn } = await loadModule();
    const result = await appleSignIn(makeSupabase() as never);

    expect(result).toEqual({ status: "signed_in", provider: "apple", authorizationCode: "apple-code" });
    expect(mockInitialize).toHaveBeenCalledWith({
      apple: { clientId: "ai.dividimos.app", useProperTokenExchange: true },
    });
    const rawNonce = mockSignInWithIdToken.mock.calls[0][0].nonce as string;
    expect(rawNonce.length).toBeGreaterThanOrEqual(32);
    expect(mockLogin).toHaveBeenCalledWith({ provider: "apple", options: { nonce: sha256(rawNonce) } });
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: "apple",
      token: "apple-id-token",
      nonce: rawNonce,
    });
  });

  it("uses a fresh nonce for every attempt", async () => {
    mockLogin.mockResolvedValue(appleLogin());
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    const { appleSignIn } = await loadModule();
    await appleSignIn(makeSupabase() as never);
    await appleSignIn(makeSupabase() as never);

    const [first, second] = mockSignInWithIdToken.mock.calls.map((call) => call[0].nonce);
    expect(first).not.toBe(second);
  });

  it.each([APPLE_CANCEL, APPLE_CANCEL_PT_BR])("treats %s as a cancellation", async (message) => {
    mockLogin.mockRejectedValue(new Error(message));

    const { appleSignIn } = await loadModule();

    expect(await appleSignIn(makeSupabase() as never)).toEqual({ status: "cancelled" });
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("reports a missing authorization code as null instead of an empty string", async () => {
    mockLogin.mockResolvedValue(appleLogin({ authorizationCode: "" }));
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    const { appleSignIn } = await loadModule();

    expect(await appleSignIn(makeSupabase() as never)).toEqual({
      status: "signed_in",
      provider: "apple",
      authorizationCode: null,
    });
  });

  it("settles and frees the sheet when the exchange throws", async () => {
    mockLogin.mockResolvedValue(appleLogin());
    mockSignInWithIdToken.mockRejectedValueOnce(new SyntaxError("Unexpected token <"));
    const { appleSignIn } = await loadModule();

    expect(await appleSignIn(makeSupabase() as never)).toEqual({ status: "failed", reason: "rejected" });

    mockSignInWithIdToken.mockResolvedValueOnce({ data: { user: { id: "user-1" } }, error: null });
    expect((await appleSignIn(makeSupabase() as never)).status).toBe("signed_in");
  });

  it("reports other authorization errors as rejected", async () => {
    mockLogin.mockRejectedValue(new Error(APPLE_FAILURE));

    const { appleSignIn } = await loadModule();

    expect(await appleSignIn(makeSupabase() as never)).toEqual({ status: "failed", reason: "rejected" });
  });

  it("separates network failures from rejected tokens", async () => {
    mockLogin.mockResolvedValue(appleLogin());
    const { appleSignIn } = await loadModule();

    mockSignInWithIdToken.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    expect(await appleSignIn(makeSupabase() as never)).toEqual({ status: "failed", reason: "network" });

    mockSignInWithIdToken.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthApiError("Nonces mismatch", 400, "bad_jwt"),
    });
    expect(await appleSignIn(makeSupabase() as never)).toEqual({ status: "failed", reason: "rejected" });
  });

  it("keeps Apple's first-authorization name for onboarding, keyed to the user", async () => {
    mockLogin.mockResolvedValue(
      appleLogin({ profile: { user: "s", email: null, givenName: " Ana ", familyName: "Souza" } }),
    );
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    const { appleSignIn } = await loadModule();
    await appleSignIn(makeSupabase() as never);

    expect(getPendingSignInName("user-1")).toBe("Ana Souza");
  });

  it("never stores an empty name from a later authorization", async () => {
    setPendingSignInName("user-1", "Ana Souza");
    mockLogin.mockResolvedValue(appleLogin());
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    const { appleSignIn } = await loadModule();
    await appleSignIn(makeSupabase() as never);

    expect(getPendingSignInName("user-1")).toBe("Ana Souza");
  });
});

describe("googleSignIn", () => {
  it("keeps Android's nonce-less Credential Manager flow", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue(googleLogin());
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: "u" } }, error: null });

    const { googleSignIn } = await loadModule();
    const result = await googleSignIn(makeSupabase() as never);

    expect(result).toEqual({ status: "signed_in", provider: "google", authorizationCode: null });
    expect(mockInitialize).toHaveBeenCalledWith({
      google: { webClientId: expect.stringContaining("apps.googleusercontent.com") },
    });
    expect(mockLogin).toHaveBeenCalledWith({ provider: "google", options: {} });
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: "google", token: "google-id-token" });
  });

  it("binds the iOS id_token to this attempt and skips the restored session", async () => {
    mockGetPlatform.mockReturnValue("ios");
    mockLogin.mockResolvedValue(googleLogin());
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: "u" } }, error: null });

    const { googleSignIn } = await loadModule();
    await googleSignIn(makeSupabase() as never);

    expect(mockInitialize).toHaveBeenCalledWith({
      google: {
        iOSClientId: "ios-client-id.apps.googleusercontent.com",
        iOSServerClientId: expect.stringContaining("apps.googleusercontent.com"),
      },
    });
    const rawNonce = mockSignInWithIdToken.mock.calls[0][0].nonce as string;
    expect(mockLogin).toHaveBeenCalledWith({
      provider: "google",
      options: { nonce: sha256(rawNonce), forcePrompt: true },
    });
  });

  it.each([
    ["ios", GOOGLE_IOS_CANCEL],
    ["android", ANDROID_CANCEL],
  ])("treats the %s cancellation as cancelled", async (platform, message) => {
    mockGetPlatform.mockReturnValue(platform);
    mockLogin.mockRejectedValue(new Error(message));

    const { googleSignIn } = await loadModule();

    expect(await googleSignIn(makeSupabase() as never)).toEqual({ status: "cancelled" });
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("does not mistake unrelated failures for a cancellation", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockRejectedValue(new Error("Google Sign-In failed: No credentials available"));

    const { googleSignIn } = await loadModule();

    expect(await googleSignIn(makeSupabase() as never)).toEqual({ status: "failed", reason: "rejected" });
  });

  it("rejects a response without an id_token", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue(googleLogin(null));

    const { googleSignIn } = await loadModule();

    expect(await googleSignIn(makeSupabase() as never)).toEqual({ status: "failed", reason: "rejected" });
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("initializes the plugin only once", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue(googleLogin());
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: "u" } }, error: null });

    const { googleSignIn } = await loadModule();
    await googleSignIn(makeSupabase() as never);
    await googleSignIn(makeSupabase() as never);

    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });
});

describe("one native sheet at a time", () => {
  it("answers busy across providers while a sheet is open, then frees the slot", async () => {
    mockGetPlatform.mockReturnValue("ios");
    const appleSheet = Promise.withResolvers<unknown>();
    mockLogin.mockImplementationOnce(() => appleSheet.promise);
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: "u" } }, error: null });

    const { appleSignIn, googleSignIn, linkAppleIdentity } = await loadModule();
    const supabase = makeSupabase() as never;
    const pending = appleSignIn(supabase);
    await vi.waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));

    expect(await googleSignIn(supabase)).toEqual({ status: "failed", reason: "busy" });
    expect(await linkAppleIdentity(supabase)).toEqual({ status: "failed", reason: "busy" });
    expect(mockLogin).toHaveBeenCalledTimes(1);

    appleSheet.resolve(appleLogin());
    expect((await pending).status).toBe("signed_in");

    mockLogin.mockResolvedValueOnce(googleLogin());
    expect((await googleSignIn(supabase)).status).toBe("signed_in");
  });

  it("frees the slot after a rejected sheet", async () => {
    mockGetPlatform.mockReturnValue("ios");
    mockLogin.mockRejectedValueOnce(new Error(APPLE_FAILURE)).mockResolvedValueOnce(appleLogin());
    mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: "u" } }, error: null });

    const { appleSignIn } = await loadModule();

    expect((await appleSignIn(makeSupabase() as never)).status).toBe("failed");
    expect((await appleSignIn(makeSupabase() as never)).status).toBe("signed_in");
  });
});

describe("identity linking", () => {
  beforeEach(() => {
    mockGetPlatform.mockReturnValue("ios");
  });

  it("links the Apple identity to the signed-in user with the same nonce contract", async () => {
    mockLogin.mockResolvedValue(appleLogin());
    mockLinkIdentity.mockResolvedValue({ data: {}, error: null });

    const { linkAppleIdentity } = await loadModule();
    const result = await linkAppleIdentity(makeSupabase() as never);

    expect(result).toEqual({ status: "linked", provider: "apple", authorizationCode: "apple-code" });
    const rawNonce = mockLinkIdentity.mock.calls[0][0].nonce as string;
    expect(mockLogin).toHaveBeenCalledWith({ provider: "apple", options: { nonce: sha256(rawNonce) } });
    expect(mockLinkIdentity).toHaveBeenCalledWith({ provider: "apple", token: "apple-id-token", nonce: rawNonce });
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it.each([
    [new AuthApiError("Manual linking is disabled", 404, "manual_linking_disabled"), "linking_disabled"],
    [new AuthApiError("Identity is already linked to another user", 422, "identity_already_exists"), "identity_in_use"],
    [new AuthRetryableFetchError("Failed to fetch", 0), "network"],
    [new AuthApiError("Invalid id token", 400, "bad_jwt"), "rejected"],
  ])("maps %s to %s", async (error, reason) => {
    mockLogin.mockResolvedValue(googleLogin());
    mockLinkIdentity.mockResolvedValue({ data: {}, error });

    const { linkGoogleIdentity } = await loadModule();

    expect(await linkGoogleIdentity(makeSupabase() as never)).toEqual({ status: "failed", reason });
  });

  it("settles silently when the person cancels the sheet", async () => {
    mockLogin.mockRejectedValue(new Error(APPLE_CANCEL));

    const { linkAppleIdentity } = await loadModule();

    expect(await linkAppleIdentity(makeSupabase() as never)).toEqual({ status: "cancelled" });
    expect(mockLinkIdentity).not.toHaveBeenCalled();
  });

  it("reads which providers are linked from the user's identities", async () => {
    mockGetUserIdentities.mockResolvedValue({
      data: { identities: [{ provider: "google" }, { provider: "apple" }] },
      error: null,
    });
    const { loadLinkedProviders } = await loadModule();

    expect(await loadLinkedProviders(makeSupabase() as never)).toEqual({ apple: true, google: true });

    mockGetUserIdentities.mockResolvedValue({ data: null, error: new AuthApiError("expired", 401, "bad_jwt") });
    await expect(loadLinkedProviders(makeSupabase() as never)).rejects.toThrow("expired");
  });
});

describe("web redirect flow", () => {
  beforeEach(() => {
    mockGetPlatform.mockReturnValue("web");
    mockIsNativePlatform.mockReturnValue(false);
    window.localStorage.clear();
    mockAssign.mockClear();
    window.location.hash = "";
  });

  it("never initializes the native plugin", async () => {
    const { prepareGoogleSignIn } = await loadModule();
    await prepareGoogleSignIn();

    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it("sends Google sha256(nonce) and keeps the raw nonce for Supabase", async () => {
    const { startGoogleRedirect, completeGoogleRedirect } = await loadModule();
    await startGoogleRedirect("/app/groups");

    const target = new URL(mockAssign.mock.calls[0][0] as string);
    expect(target.origin + target.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(target.searchParams.get("response_type")).toBe("id_token");
    expect(target.searchParams.get("redirect_uri")).toBe(`${window.location.origin}/auth/popup`);
    expect(target.searchParams.get("client_id")).toContain("apps.googleusercontent.com");

    window.location.hash = "#id_token=web-token";
    mockSignInWithIdToken.mockResolvedValue({ error: null });
    const next = await completeGoogleRedirect(makeSupabase() as never);

    expect(next).toBe("/app/groups");
    const rawNonce = mockSignInWithIdToken.mock.calls[0][0].nonce as string;
    expect(target.searchParams.get("nonce")).toBe(sha256(rawNonce));
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "web-token",
      nonce: rawNonce,
    });
  });

  it("returns null when the fragment carries no id_token", async () => {
    const { startGoogleRedirect, completeGoogleRedirect } = await loadModule();
    await startGoogleRedirect("/app");
    window.location.hash = "#error=access_denied";

    expect(await completeGoogleRedirect(makeSupabase() as never)).toBeNull();
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("returns null for a fragment that no redirect of ours started", async () => {
    const { completeGoogleRedirect } = await loadModule();
    window.location.hash = "#id_token=injected";

    expect(await completeGoogleRedirect(makeSupabase() as never)).toBeNull();
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("returns null and forgets the nonce when Supabase rejects the token", async () => {
    const { startGoogleRedirect, completeGoogleRedirect } = await loadModule();
    await startGoogleRedirect("/app");
    window.location.hash = "#id_token=web-token";
    mockSignInWithIdToken.mockResolvedValue({ error: new Error("nonce mismatch") });

    expect(await completeGoogleRedirect(makeSupabase() as never)).toBeNull();

    window.location.hash = "#id_token=web-token";
    mockSignInWithIdToken.mockResolvedValue({ error: null });
    expect(await completeGoogleRedirect(makeSupabase() as never)).toBeNull();
    expect(mockSignInWithIdToken).toHaveBeenCalledTimes(1);
  });
});
