import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { decodeMe } from "@/lib/ledger/decode";
import type { Me } from "@/types/ledger";

/**
 * Load the authenticated caller's own profile.
 *
 * Identity comes from locally verified JWT claims, so no network round trip
 * to the auth server is needed before loading the profile.
 *
 * The profile row comes from the argument-free `get_my_profile` RPC, which
 * derives its row from `auth.uid()`. The returned ID is compared against the
 * verified auth ID to enforce the account-isolation guarantee.
 */
export const getAuthUser = cache(async (): Promise<Me | null> => {
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims) return null;
  const { data, error } = await supabase.rpc("get_my_profile");
  if (error || !data) return null;
  const decoded = decodeMe(data);
  if (!decoded.ok) return null;
  const me = decoded.value;
  if (me.id !== claims.claims.sub) return null;
  return me;
});
