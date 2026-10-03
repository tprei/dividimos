import "server-only";
import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";

export const APPLE_CLIENT_ID = "ai.dividimos.app";
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_TOKEN_ENDPOINT = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_ENDPOINT = "https://appleid.apple.com/auth/revoke";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

// Apple allows a client secret to live up to six months; minting a fresh one
// per request with a five-minute ceiling keeps a leaked secret window tiny and
// removes any rotation task: the .p8 signing key itself has no expiry.
const CLIENT_SECRET_TTL_SECONDS = 300;
// Deletion waits on Apple after delete_account committed; a hung endpoint must
// end in a retryable answer, not a platform timeout with no JSON body.
const APPLE_REQUEST_TIMEOUT_MS = 10_000;

export interface AppleServerConfig {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
}

export type AppleSignInFailureReason =
  | "unavailable"
  | "code_rejected"
  | "identity_mismatch"
  | "unexpected_response";

export class AppleSignInError extends Error {
  readonly reason: AppleSignInFailureReason;

  constructor(reason: AppleSignInFailureReason, message: string, options?: { cause?: unknown }) {
    super(message, options === undefined ? undefined : { cause: options.cause });
    this.name = "AppleSignInError";
    this.reason = reason;
  }
}

/**
 * Reads APPLE_TEAM_ID, APPLE_SIGN_IN_KEY_ID and APPLE_SIGN_IN_PRIVATE_KEY
 * (a .p8 PEM that Vercel stores with escaped newlines), or null when the
 * server-side Sign in with Apple keys are not configured.
 */
export function readAppleServerConfig(): AppleServerConfig | null {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_SIGN_IN_KEY_ID;
  const privateKeyPem = process.env.APPLE_SIGN_IN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!teamId || !keyId || !privateKeyPem) return null;
  return { teamId, keyId, privateKeyPem };
}

/**
 * Mints the per-request client secret: ES256 JWT signed with the .p8,
 * {iss: team, aud: Apple, sub: bundle id}, exp at most five minutes out.
 */
export async function createAppleClientSecret(
  config: AppleServerConfig,
  now: Date = new Date(),
): Promise<string> {
  const key = await importPKCS8(config.privateKeyPem, "ES256");
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + CLIENT_SECRET_TTL_SECONDS)
    .setAudience(APPLE_ISSUER)
    .setSubject(APPLE_CLIENT_ID)
    .sign(key);
}

const appleJwks = createRemoteJWKSet(new URL(APPLE_JWKS_URL));

async function verifyWithAppleJwks(idToken: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, appleJwks, {
    issuer: APPLE_ISSUER,
    audience: APPLE_CLIENT_ID,
  });
  return payload;
}

export interface AppleFetchDeps {
  fetchImpl?: typeof fetch;
  verifyIdToken?: (idToken: string) => Promise<JWTPayload>;
}

export interface AppleExchangeResult {
  /** Verified Apple identity token; its sub is the Apple subject. */
  appleSubject: string;
  refreshToken: string;
}

async function appleErrorBody(response: Response): Promise<string | null> {
  try {
    const parsed: unknown = await response.json();
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const error = (parsed as Record<string, unknown>).error;
      if (typeof error === "string") return error;
    }
  } catch {
    // Apple error bodies are diagnostics only; a missing one is not fatal.
  }
  return null;
}

interface AppleTokenResponse {
  id_token: unknown;
  refresh_token: unknown;
}

/**
 * Exchanges Apple's single-use authorization code at the token endpoint and
 * verifies the returned id_token signature (Apple JWKS), issuer and audience.
 * Resolves only when the verified token subject equals `expectedAppleSubject`,
 * the identity Supabase stored for the caller.
 */
export async function exchangeAppleAuthorizationCode(
  authorizationCode: string,
  expectedAppleSubject: string,
  config: AppleServerConfig,
  deps: AppleFetchDeps = {},
): Promise<AppleExchangeResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const verifyIdToken = deps.verifyIdToken ?? verifyWithAppleJwks;
  let clientSecret: string;
  try {
    clientSecret = await createAppleClientSecret(config);
  } catch (thrown) {
    throw new AppleSignInError("unavailable", "APPLE_SIGN_IN_PRIVATE_KEY is not a usable ES256 key", {
      cause: thrown,
    });
  }

  let response: Response;
  try {
    response = await doFetch(APPLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: APPLE_CLIENT_ID,
        client_secret: clientSecret,
        code: authorizationCode,
      }),
      signal: AbortSignal.timeout(APPLE_REQUEST_TIMEOUT_MS),
    });
  } catch (thrown) {
    throw new AppleSignInError("unavailable", "Apple token endpoint unreachable", { cause: thrown });
  }

  if (!response.ok) {
    const error = await appleErrorBody(response);
    if (response.status === 400 && error === "invalid_grant") {
      // Single-use code already consumed, expired, or the user revoked.
      throw new AppleSignInError("code_rejected", "Apple rejected the authorization code");
    }
    throw new AppleSignInError(
      "unavailable",
      `Apple token endpoint returned ${response.status}${error === null ? "" : ` (${error})`}`,
    );
  }

  let tokenBody: AppleTokenResponse;
  try {
    const parsed: unknown = await response.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("not an object");
    }
    tokenBody = parsed as AppleTokenResponse;
  } catch (thrown) {
    throw new AppleSignInError("unexpected_response", "Apple token response is not an object", {
      cause: thrown,
    });
  }
  const { id_token: idToken, refresh_token: refreshToken } = tokenBody;
  if (typeof idToken !== "string" || idToken === "" || typeof refreshToken !== "string" || refreshToken === "") {
    throw new AppleSignInError("unexpected_response", "Apple token response lacks usable tokens");
  }

  let claims: JWTPayload;
  try {
    claims = await verifyIdToken(idToken);
  } catch (thrown) {
    throw new AppleSignInError("unexpected_response", "Apple id_token failed verification", {
      cause: thrown,
    });
  }
  if (claims.sub !== expectedAppleSubject) {
    throw new AppleSignInError(
      "identity_mismatch",
      "Apple id_token subject does not match the caller's linked Apple identity",
    );
  }
  return { appleSubject: claims.sub, refreshToken };
}

export type AppleRevokeOutcome = "revoked" | "invalid_grant" | "unavailable";

/**
 * Revokes the stored Apple authorization by refresh token. `invalid_grant`
 * means Apple no longer knows the token (already revoked, expired), which is
 * as good as revoked for the deletion flow; `unavailable` is retryable.
 */
export async function revokeAppleAuthorization(
  refreshToken: string,
  config: AppleServerConfig,
  deps: Pick<AppleFetchDeps, "fetchImpl"> = {},
): Promise<AppleRevokeOutcome> {
  const doFetch = deps.fetchImpl ?? fetch;
  // A malformed key is a server configuration error, never proof that Apple
  // forgot the token, so it stays retryable and the stored token survives.
  try {
    const clientSecret = await createAppleClientSecret(config);
    const response = await doFetch(APPLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: APPLE_CLIENT_ID,
        client_secret: clientSecret,
        token: refreshToken,
        token_type_hint: "refresh_token",
      }),
      signal: AbortSignal.timeout(APPLE_REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return "revoked";
    const error = await appleErrorBody(response);
    if (response.status === 400 && error === "invalid_grant") return "invalid_grant";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
