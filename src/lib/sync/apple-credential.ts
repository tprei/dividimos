import type { AppleCredentialResponse } from "@/lib/apple-credential";
import { decodeAppleCredentialResponse } from "@/lib/apple-credential";

export type AppleCredentialFailureCode = Exclude<AppleCredentialResponse, { ok: true }>["code"];

/** Thrown when the server refuses to store the Apple credential. */
export class AppleCredentialError extends Error {
  readonly code: AppleCredentialFailureCode;
  readonly status: number;

  constructor(code: AppleCredentialFailureCode, status: number, options?: { cause?: unknown }) {
    super(`apple credential registration failed: ${code}`, options);
    this.name = "AppleCredentialError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Uploads the single-use Apple authorization code right after a successful
 * native sign-in or account link, so the server can later revoke the Apple
 * authorization at account deletion. The Apple identity must already be
 * linked to the signed-in Supabase user, or the route answers 403.
 */
export async function registerAppleCredential(authorizationCode: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/auth/apple/credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorizationCode }),
    });
  } catch (thrown) {
    throw new AppleCredentialError("apple_unavailable", 0, { cause: thrown });
  }
  if (response.ok) return;
  const raw: unknown = await response.json().catch(() => null);
  const decoded = decodeAppleCredentialResponse(raw);
  throw new AppleCredentialError(
    decoded !== null && !decoded.ok ? decoded.code : "apple_unavailable",
    response.status,
  );
}

/**
 * Stores the code from a successful Apple sign-in or link without holding up
 * the person: sign-in must not wait on, or fail because of, revocation
 * material, and the next Apple authorization brings a fresh code.
 */
export function storeAppleAuthorization(authorizationCode: string | null): void {
  if (authorizationCode === null) return;
  registerAppleCredential(authorizationCode).catch((error: unknown) => {
    console.error("[apple-credential] could not store the Apple authorization", error);
  });
}
