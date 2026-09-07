import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { mapOwnerProfileRow } from "@/lib/owner-profile";

/**
 * Load the authenticated caller's own profile.
 *
 * Identity comes from locally verified JWT claims, so no network round trip
 * to the auth server is needed before loading the profile.
 *
 * The profile row comes from the argument-free `get_my_profile` RPC, which
 * derives its row from `auth.uid()`. Reading `users` by ID would instead go
 * through `users_read_visible`, which also exposes related accounts, so a
 * request issued for one account could return that account's row after the
 * session had already changed to a related one. The returned ID is compared
 * against the verified auth ID to reject exactly that case.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims) return null;
  const { data, error } = await supabase.rpc("get_my_profile");
  if (error || !Array.isArray(data) || data.length !== 1) return null;
  const profile = mapOwnerProfileRow(data[0]);
  if (!profile || profile.id !== claims.claims.sub) return null;
  return profile;
});
