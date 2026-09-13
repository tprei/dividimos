-- P3b: close the profile-lookup rate-limit bypass.
--
-- lookup_user_by_handle is a SECURITY DEFINER read of user profiles that
-- previously let any authenticated client call it directly (supabase-js
-- rpc), skipping the /api/users/lookup boundary that owns the
-- users.lookup rate limit. From here on the boundary is route-only: the
-- route authenticates the caller, spends the rate-limit token, and calls
-- this function through the service role. No browser role may execute it.
REVOKE ALL ON FUNCTION public.lookup_user_by_handle(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_handle(text) TO service_role;
