import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPlatform = vi.fn(() => "android");
const mockIsNativePlatform = vi.fn(() => true);
const mockInitialize = vi.fn();
const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockSignInWithIdToken = vi.fn();

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

async function loadModule() {
  return import("./auth");
}

describe("ensureInitialized (via nativeGoogleSignIn)", () => {
  it("passes webClientId on Android", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue({ result: { idToken: "tok" } });
    mockSignInWithIdToken.mockResolvedValue({ error: null });

    const { nativeGoogleSignIn } = await loadModule();
    await nativeGoogleSignIn(makeSupabase() as never);

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

    const { nativeGoogleSignIn } = await loadModule();
    await nativeGoogleSignIn(makeSupabase() as never);

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

    const { nativeGoogleSignIn } = await loadModule();
    const supabase = makeSupabase() as never;
    await nativeGoogleSignIn(supabase);
    await nativeGoogleSignIn(supabase);

    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });
});

describe("nativeGoogleSignIn", () => {
  it("returns true on successful sign-in", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue({ result: { idToken: "valid-token" } });
    mockSignInWithIdToken.mockResolvedValue({ error: null });

    const { nativeGoogleSignIn } = await loadModule();
    const result = await nativeGoogleSignIn(makeSupabase() as never);

    expect(result).toBe(true);
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "valid-token",
    });
  });

  it("returns false when no idToken is returned", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue({ result: {} });

    const { nativeGoogleSignIn } = await loadModule();
    const result = await nativeGoogleSignIn(makeSupabase() as never);

    expect(result).toBe(false);
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("returns false when signInWithIdToken fails on Android (no retry)", async () => {
    mockGetPlatform.mockReturnValue("android");
    mockLogin.mockResolvedValue({ result: { idToken: "tok" } });
    mockSignInWithIdToken.mockResolvedValue({ error: new Error("bad") });

    const { nativeGoogleSignIn } = await loadModule();
    const result = await nativeGoogleSignIn(makeSupabase() as never);

    expect(result).toBe(false);
    expect(mockLogout).not.toHaveBeenCalled();
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

    const { nativeGoogleSignIn } = await loadModule();
    const result = await nativeGoogleSignIn(makeSupabase() as never);

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

    const { nativeGoogleSignIn } = await loadModule();
    const result = await nativeGoogleSignIn(makeSupabase() as never);

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

    const { nativeGoogleSignIn } = await loadModule();
    const result = await nativeGoogleSignIn(makeSupabase() as never);

    expect(result).toBe(false);
  });
});

describe("getPlatform", () => {
  it("returns the Capacitor platform string", async () => {
    mockGetPlatform.mockReturnValue("ios");
    const { getPlatform } = await loadModule();
    expect(getPlatform()).toBe("ios");
  });
});

describe("isNativePlatform", () => {
  it("delegates to Capacitor.isNativePlatform", async () => {
    mockIsNativePlatform.mockReturnValue(true);
    const { isNativePlatform } = await loadModule();
    expect(isNativePlatform()).toBe(true);
  });
});
