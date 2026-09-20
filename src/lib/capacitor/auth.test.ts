import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mockGetPlatform = vi.fn(() => "android");
const mockIsNativePlatform = vi.fn(() => true);
const mockInitialize = vi.fn();
const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockSignInWithIdToken = vi.fn();
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

function makeSupabase() {
  return {
    auth: {
      signInWithIdToken: mockSignInWithIdToken,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
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

async function loadModule() {
  return import("./auth");
}

describe("ensureInitialized (via googleSignIn)", () => {
  it("passes webClientId on Android", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue({ result: { idToken: "tok" } });
    mockSignInWithIdToken.mockResolvedValue({ error: null });

    const { googleSignIn } = await loadModule();
    await googleSignIn(makeSupabase() as never);

    expect(mockInitialize).toHaveBeenCalledWith({
      google: {
        webClientId: expect.stringContaining("apps.googleusercontent.com"),
      },
    });
    expect(mockInitialize.mock.calls[0][0].google).not.toHaveProperty("iOSClientId");
  });

  it("passes iOSClientId and iOSServerClientId on iOS", async () => {
    mockGetPlatform.mockReturnValue("ios");
    mockLogin.mockResolvedValue({ result: { idToken: "tok" } });
    mockSignInWithIdToken.mockResolvedValue({ error: null });

    const { googleSignIn } = await loadModule();
    await googleSignIn(makeSupabase() as never);

    expect(mockInitialize).toHaveBeenCalledWith({
      google: {
        iOSClientId: "ios-client-id.apps.googleusercontent.com",
        iOSServerClientId: expect.stringContaining("apps.googleusercontent.com"),
      },
    });
    expect(mockInitialize.mock.calls[0][0].google).not.toHaveProperty("webClientId");
  });

  it("initializes only once", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue({ result: { idToken: "tok" } });
    mockSignInWithIdToken.mockResolvedValue({ error: null });

    const { googleSignIn } = await loadModule();
    const supabase = makeSupabase() as never;
    await googleSignIn(supabase);
    await googleSignIn(supabase);

    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });
});

describe("googleSignIn", () => {
  it("returns true on successful sign-in", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue({ result: { idToken: "valid-token" } });
    mockSignInWithIdToken.mockResolvedValue({ error: null });

    const { googleSignIn } = await loadModule();
    const result = await googleSignIn(makeSupabase() as never);

    expect(result).toBe(true);
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "valid-token",
    });
  });

  it("returns false when no idToken is returned", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue({ result: {} });

    const { googleSignIn } = await loadModule();
    const result = await googleSignIn(makeSupabase() as never);

    expect(result).toBe(false);
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("returns false when signInWithIdToken fails on Android (no retry)", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue({ result: { idToken: "tok" } });
    mockSignInWithIdToken.mockResolvedValue({ error: new Error("bad") });

    const { googleSignIn } = await loadModule();
    const result = await googleSignIn(makeSupabase() as never);

    expect(result).toBe(false);
    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockSignInWithIdToken).toHaveBeenCalledTimes(1);
  });

  it("does not touch the plugin's web popup path", async () => {
    mockGetPlatform.mockReturnValue("web");
    mockIsNativePlatform.mockReturnValue(false);

    const { prepareGoogleSignIn } = await loadModule();
    await prepareGoogleSignIn();

    expect(mockInitialize).not.toHaveBeenCalled();
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
    expect(target.searchParams.get("nonce")).toBe(
      createHash("sha256").update(rawNonce).digest("hex"),
    );
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

describe("iOS retry logic", () => {
  it("retries with logout on iOS when first signInWithIdToken fails", async () => {
    mockGetPlatform.mockReturnValue("ios");
    mockLogin
      .mockResolvedValueOnce({ result: { idToken: "stale-token" } })
      .mockResolvedValueOnce({ result: { idToken: "fresh-token" } });
    mockSignInWithIdToken
      .mockResolvedValueOnce({ error: new Error("nonce mismatch") })
      .mockResolvedValueOnce({ error: null });

    const { googleSignIn } = await loadModule();
    const result = await googleSignIn(makeSupabase() as never);

    expect(result).toBe(true);
    expect(mockLogout).toHaveBeenCalledWith({ provider: "google" });
    expect(mockSignInWithIdToken).toHaveBeenCalledTimes(2);
    expect(mockSignInWithIdToken).toHaveBeenLastCalledWith({
      provider: "google",
      token: "fresh-token",
    });
  });

  it("returns false when iOS retry also fails", async () => {
    mockGetPlatform.mockReturnValue("ios");
    mockLogin
      .mockResolvedValueOnce({ result: { idToken: "stale" } })
      .mockResolvedValueOnce({ result: { idToken: "still-stale" } });
    mockSignInWithIdToken
      .mockResolvedValueOnce({ error: new Error("fail1") })
      .mockResolvedValueOnce({ error: new Error("fail2") });

    const { googleSignIn } = await loadModule();
    const result = await googleSignIn(makeSupabase() as never);

    expect(result).toBe(false);
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockSignInWithIdToken).toHaveBeenCalledTimes(2);
  });

  it("returns false when iOS retry gets no token", async () => {
    mockGetPlatform.mockReturnValue("ios");
    mockLogin
      .mockResolvedValueOnce({ result: { idToken: "stale" } })
      .mockResolvedValueOnce({ result: {} });
    mockSignInWithIdToken.mockResolvedValue({ error: new Error("fail") });

    const { googleSignIn } = await loadModule();
    const result = await googleSignIn(makeSupabase() as never);

    expect(result).toBe(false);
  });
});

describe("isNativePlatform", () => {
  it("delegates to Capacitor.isNativePlatform", async () => {
    mockIsNativePlatform.mockReturnValue(true);
    const { isNativePlatform } = await loadModule();
    expect(isNativePlatform()).toBe(true);
  });
});
