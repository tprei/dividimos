import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from "jose";
import {
  APPLE_CLIENT_ID,
  createAppleClientSecret,
  exchangeAppleAuthorizationCode,
  readAppleServerConfig,
  revokeAppleAuthorization,
} from "./apple-sign-in";

const APPLE_ISSUER = "https://appleid.apple.com";
const TEAM_ID = "TEAM123456";
const KEY_ID = "KEYID99";

const keys = await generateKeyPair("ES256", { extractable: true });
const privateKeyPem = await exportPKCS8(keys.privateKey);
const config = { teamId: TEAM_ID, keyId: KEY_ID, privateKeyPem };

async function signAppleIdToken(subject: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: "apple-server-key" })
    .setIssuer(APPLE_ISSUER)
    .setAudience(APPLE_CLIENT_ID)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}

// The same checks the production default verifier runs, but against the test
// key: signature, issuer and audience all have to hold.
const verifyIdToken = async (token: string) =>
  (await jwtVerify(token, keys.publicKey, { issuer: APPLE_ISSUER, audience: APPLE_CLIENT_ID }))
    .payload;

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createAppleClientSecret", () => {
  it("mints an ES256 secret verifiable with the key's public half", async () => {
    const before = Math.floor(Date.now() / 1000);
    const secret = await createAppleClientSecret(config);
    const { protectedHeader, payload } = await jwtVerify(secret, keys.publicKey);

    expect(protectedHeader).toMatchObject({ alg: "ES256", kid: KEY_ID });
    expect(payload.iss).toBe(TEAM_ID);
    expect(payload.aud).toBe(APPLE_ISSUER);
    expect(payload.sub).toBe(APPLE_CLIENT_ID);
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    const iat = payload.iat ?? 0;
    const exp = payload.exp ?? 0;
    // Apple's ceiling for this route's secrets: five minutes, never more.
    expect(exp).toBe(iat + 300);
    expect(exp).toBeLessThanOrEqual(before + 300);
  });

  it("honors an injected clock so the expiry claim stays deterministic", async () => {
    const now = new Date("2026-10-03T12:00:00Z");
    const secret = await createAppleClientSecret(config, now);
    const { payload } = await jwtVerify(secret, keys.publicKey, { currentDate: now });
    expect(payload.iat).toBe(Math.floor(now.getTime() / 1000));
    expect(payload.exp).toBe(Math.floor(now.getTime() / 1000) + 300);
  });
});

describe("readAppleServerConfig", () => {
  beforeEach(() => {
    vi.stubEnv("APPLE_TEAM_ID", TEAM_ID);
    vi.stubEnv("APPLE_SIGN_IN_KEY_ID", KEY_ID);
    vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", privateKeyPem);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the three server values", () => {
    expect(readAppleServerConfig()).toEqual({ teamId: TEAM_ID, keyId: KEY_ID, privateKeyPem });
  });

  it("treats any missing variable as unconfigured", () => {
    vi.stubEnv("APPLE_SIGN_IN_KEY_ID", "");
    expect(readAppleServerConfig()).toBeNull();
  });

  it("unescapes the \\n newlines Vercel stores inside the .p8", async () => {
    const escaped = privateKeyPem.replaceAll("\n", "\\n");
    vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", escaped);
    const read = readAppleServerConfig();
    expect(read).not.toBeNull();
    const secret = await createAppleClientSecret(read!);
    await expect(jwtVerify(secret, keys.publicKey)).resolves.toBeTruthy();
  });
});

describe("exchangeAppleAuthorizationCode", () => {
  it("posts the code with a fresh client secret and returns the verified subject", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ id_token: await signAppleIdToken("apple-sub-1"), refresh_token: "rt-1" }),
    );

    const result = await exchangeAppleAuthorizationCode("code-1", "apple-sub-1", config, {
      fetchImpl: fetchMock,
      verifyIdToken,
    });

    expect(result).toEqual({ appleSubject: "apple-sub-1", refreshToken: "rt-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://appleid.apple.com/auth/token");
    expect(init?.method).toBe("POST");
    const body = init?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe(APPLE_CLIENT_ID);
    expect(body.get("code")).toBe("code-1");
    const secret = body.get("client_secret") ?? "";
    const verified = await jwtVerify(secret, keys.publicKey);
    expect(verified.payload).toMatchObject({ iss: TEAM_ID, sub: APPLE_CLIENT_ID });
  });

  it("rejects when the id_token subject differs from the caller's Apple identity", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ id_token: await signAppleIdToken("attacker-sub"), refresh_token: "rt-2" }),
    );

    await expect(
      exchangeAppleAuthorizationCode("code-2", "apple-sub-1", config, {
        fetchImpl: fetchMock,
        verifyIdToken,
      }),
    ).rejects.toMatchObject({
      name: "AppleSignInError",
      reason: "identity_mismatch",
    });
  });

  it("refuses a code Apple already consumed as a rejected code", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ error: "invalid_grant" }, 400),
    );

    await expect(
      exchangeAppleAuthorizationCode("code-3", "apple-sub-1", config, {
        fetchImpl: fetchMock,
        verifyIdToken,
      }),
    ).rejects.toMatchObject({ name: "AppleSignInError", reason: "code_rejected" });
  });

  it("maps transport failures and Apple outages to unavailable", async () => {
    const failingFetch = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("offline"));
    await expect(
      exchangeAppleAuthorizationCode("code-4", "apple-sub-1", config, {
        fetchImpl: failingFetch,
        verifyIdToken,
      }),
    ).rejects.toMatchObject({ name: "AppleSignInError", reason: "unavailable" });

    const serverError = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("boom", { status: 500 }),
    );
    await expect(
      exchangeAppleAuthorizationCode("code-4", "apple-sub-1", config, {
        fetchImpl: serverError,
        verifyIdToken,
      }),
    ).rejects.toMatchObject({ name: "AppleSignInError", reason: "unavailable" });
  });

  it("refuses an id_token that fails signature or issuer checks", async () => {
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://evil.example")
      .setAudience(APPLE_CLIENT_ID)
      .setSubject("apple-sub-1")
      .setIssuedAt()
      .sign(keys.privateKey);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(tokenResponse({ id_token: forged, refresh_token: "rt-3" }));

    await expect(
      exchangeAppleAuthorizationCode("code-5", "apple-sub-1", config, {
        fetchImpl: fetchMock,
        verifyIdToken,
      }),
    ).rejects.toMatchObject({ name: "AppleSignInError", reason: "unexpected_response" });
  });

  it("refuses a token response without both tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(tokenResponse({ id_token: await signAppleIdToken("s") }));

    await expect(
      exchangeAppleAuthorizationCode("code-6", "s", config, {
        fetchImpl: fetchMock,
        verifyIdToken,
      }),
    ).rejects.toMatchObject({ name: "AppleSignInError", reason: "unexpected_response" });
  });
});

describe("revokeAppleAuthorization", () => {
  it("revokes with the refresh token and the token type hint", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      revokeAppleAuthorization("rt-9", config, { fetchImpl: fetchMock }),
    ).resolves.toBe("revoked");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://appleid.apple.com/auth/revoke");
    const body = init?.body as URLSearchParams;
    expect(body.get("token")).toBe("rt-9");
    expect(body.get("token_type_hint")).toBe("refresh_token");
    expect(body.get("client_id")).toBe(APPLE_CLIENT_ID);
    await expect(jwtVerify(body.get("client_secret") ?? "", keys.publicKey)).resolves.toBeTruthy();
  });

  it("treats invalid_grant as already revoked", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(tokenResponse({ error: "invalid_grant" }, 400));
    await expect(
      revokeAppleAuthorization("rt-10", config, { fetchImpl: fetchMock }),
    ).resolves.toBe("invalid_grant");
  });

  it("reports outages and transport errors as unavailable", async () => {
    const serverError = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, { status: 503 }),
    );
    await expect(
      revokeAppleAuthorization("rt-11", config, { fetchImpl: serverError }),
    ).resolves.toBe("unavailable");

    const failing = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("offline"));
    await expect(
      revokeAppleAuthorization("rt-11", config, { fetchImpl: failing }),
    ).resolves.toBe("unavailable");
  });

  it("keeps an unusable signing key retryable instead of calling Apple", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const broken = { ...config, privateKeyPem: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----" };

    await expect(revokeAppleAuthorization("rt-12", broken, { fetchImpl })).resolves.toBe("unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
