import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";
import { AppError } from "@/lib/errors";
import { decryptPixKey } from "@/lib/crypto";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getUserById: vi.fn(),
  rpc: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: mocks.getClaims } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: mocks.getUserById } },
    rpc: mocks.rpc,
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const APPLE_SUB = "001234.abcdef1234567890.1234";
const TEAM_ID = "TEAM123456";
const KEY_ID = "KEYID99";
const PIX_KEY_HEX = "0123456789abcdef".repeat(4);
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";

const keys = await generateKeyPair("ES256", { extractable: true });
const privateKeyPem = await exportPKCS8(keys.privateKey);
const jwk = { ...(await exportJWK(keys.publicKey)), kid: KEY_ID, alg: "ES256", use: "sig" };

async function signIdToken(subject: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
    .setIssuer("https://appleid.apple.com")
    .setAudience("ai.dividimos.app")
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}

let appleTokenResponse: Response | null = null;
const realFetch = globalThis.fetch;
const appleFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === APPLE_JWKS_URL) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  if (url === APPLE_TOKEN_URL) {
    if (appleTokenResponse === null) throw new Error("connect ECONNREFUSED");
    return appleTokenResponse;
  }
  return realFetch(input, init);
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/apple/credential", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function appleIdentity(subject: string): Record<string, unknown> {
  return { provider: "apple", id: subject, identity_data: { sub: subject } };
}

beforeEach(() => {
  appleTokenResponse = null;
  vi.stubEnv("APPLE_TEAM_ID", TEAM_ID);
  vi.stubEnv("APPLE_SIGN_IN_KEY_ID", KEY_ID);
  vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", privateKeyPem);
  vi.stubEnv("PIX_ENCRYPTION_KEY", PIX_KEY_HEX);
  vi.stubGlobal("fetch", appleFetch);
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: USER_ID } }, error: null });
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.getUserById.mockResolvedValue({
    data: { user: { identities: [appleIdentity(APPLE_SUB)] } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("POST /api/auth/apple/credential", () => {
  it("answers 401 without claims and ignores a caller override in the body", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: { message: "bad token" } });
    const failed = await POST(makeRequest({ authorizationCode: "code" }));
    expect(failed.status).toBe(401);
    expect(await failed.json()).toEqual({ ok: false, code: "unauthenticated" });

    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    const noData = await POST(makeRequest({ authorizationCode: "code" }));
    expect(noData.status).toBe(401);
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed body or authorization code", async () => {
    const notJson = await POST(makeRequest("não sou json"));
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ ok: false, code: "invalid_argument" });

    for (const body of [
      {},
      { authorizationCode: "code", extra: 1 },
      { authorizationCode: 7 },
      { authorizationCode: "" },
      { authorizationCode: "code with spaces" },
      { authorizationCode: "x".repeat(1025) },
    ]) {
      const response = await POST(makeRequest(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
  });

  it("answers 429 when the limiter refuses and 503 when it is unavailable", async () => {
    mocks.enforceRateLimit.mockRejectedValueOnce(
      new AppError("RATE_LIMIT_EXCEEDED", "limite"),
    );
    const limited = await POST(makeRequest({ authorizationCode: "code" }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ ok: false, code: "apple_rate_limited" });
    expect(mocks.getUserById).not.toHaveBeenCalled();

    mocks.enforceRateLimit.mockRejectedValueOnce(
      new AppError("RATE_LIMIT_UNAVAILABLE", "limiter down"),
    );
    const unavailable = await POST(makeRequest({ authorizationCode: "code" }));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ ok: false, code: "apple_unavailable" });
  });

  it("answers 503 and logs when the Apple server env is missing", async () => {
    vi.stubEnv("APPLE_TEAM_ID", "");
    const response = await POST(makeRequest({ authorizationCode: "code" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "apple_unavailable" });
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(appleFetch).not.toHaveBeenCalled();
  });

  it("answers 403 when the caller has no linked Apple identity", async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: { identities: [{ provider: "google", id: "g-1", identity_data: {} }] } },
      error: null,
    });
    const response = await POST(makeRequest({ authorizationCode: "code" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "apple_identity_mismatch" });
    expect(appleFetch).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 403 and stores nothing when the token subject differs from the linked identity", async () => {
    appleTokenResponse = new Response(
      JSON.stringify({ id_token: await signIdToken("attacker-sub"), refresh_token: "rt" }),
      { status: 200 },
    );
    const response = await POST(makeRequest({ authorizationCode: "code" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "apple_identity_mismatch" });
    expect(appleFetch).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 503 when Apple is unreachable and stores nothing", async () => {
    const response = await POST(makeRequest({ authorizationCode: "code" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "apple_unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 403 when the account is already deleted", async () => {
    appleTokenResponse = new Response(
      JSON.stringify({ id_token: await signIdToken(APPLE_SUB), refresh_token: "rt" }),
      { status: 200 },
    );
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "account_deleted" } });
    const response = await POST(makeRequest({ authorizationCode: "code" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "account_deleted" });
  });

  it("stores the encrypted refresh token under the verified subject", async () => {
    appleTokenResponse = new Response(
      JSON.stringify({ id_token: await signIdToken(APPLE_SUB), refresh_token: "refresh-token-xyz" }),
      { status: 200 },
    );
    const response = await POST(makeRequest({ authorizationCode: "code-1" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = mocks.rpc.mock.calls[0];
    expect(fn).toBe("store_apple_credential");
    expect(args).toMatchObject({ p_user_id: USER_ID, p_apple_subject: APPLE_SUB });
    expect(decryptPixKey(args.p_refresh_token_encrypted)).toBe("refresh-token-xyz");
  });
});
