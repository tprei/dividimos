import { cache } from "react";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { decodeMe } from "@/lib/ledger/decode";
import type { Me } from "@/types/ledger";

export type AuthProfileResult =
  | { kind: "unauthenticated" }
  | { kind: "profile_missing" }
  | { kind: "read_failed" }
  | { kind: "ok"; me: Me };

/**
 * Resolve the authenticated caller's own profile.
 *
 * Identity comes from locally verified JWT claims, so no network round trip
 * to the auth server is needed before loading the profile. Successful
 * absence of claims and the installed SDK's explicit AuthSessionMissingError
 * are both "unauthenticated"; thrown errors, unknown claims failures and
 * payloads that fail validation are "read_failed" — a caller may retry, and
 * must never treat them as a signed-out user.
 *
 * The profile row comes from the argument-free `get_my_profile` RPC, which
 * derives its row from `auth.uid()`. The returned ID is compared against the
 * verified auth ID to enforce the account-isolation guarantee.
 */
export const resolveAuthProfile = cache(async (): Promise<AuthProfileResult> => {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return { kind: "read_failed" };
  }

  let claimsResult: Awaited<ReturnType<typeof supabase.auth.getClaims>>;
  try {
    claimsResult = await supabase.auth.getClaims();
  } catch (thrown) {
    return isAuthSessionMissingError(thrown)
      ? { kind: "unauthenticated" }
      : { kind: "read_failed" };
  }
  const { data: claims, error: claimsError } = claimsResult;

  if (claimsError == null && claims == null) return { kind: "unauthenticated" };
  if (claimsError != null) {
    return isAuthSessionMissingError(claimsError)
      ? { kind: "unauthenticated" }
      : { kind: "read_failed" };
  }
  if (claims == null) return { kind: "read_failed" };

  const subject: unknown = claims.claims.sub;
  if (typeof subject !== "string" || subject === "") return { kind: "read_failed" };

  let rpcResult: Awaited<ReturnType<typeof supabase.rpc<"get_my_profile">>>;
  try {
    rpcResult = await supabase.rpc("get_my_profile");
  } catch {
    return { kind: "read_failed" };
  }
  const { data, error } = rpcResult;
  if (error != null) return { kind: "read_failed" };
  if (data == null) return { kind: "profile_missing" };

  const decoded = decodeMe(data);
  if (!decoded.ok) return { kind: "read_failed" };
  if (decoded.value.id !== subject) return { kind: "read_failed" };
  return { kind: "ok", me: decoded.value };
});
