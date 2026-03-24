-- Make user_profiles view security-definer behavior explicit.
-- PostgreSQL views default to security-definer (bypass RLS of underlying tables),
-- which is what we rely on so authenticated users can look up other users' public
-- profiles even though the `users` table has a `users_read_own` RLS policy.
-- Making this explicit prevents silent breakage if defaults ever change.
CREATE OR REPLACE VIEW public.user_profiles
  WITH (security_invoker = false) AS
  SELECT id, handle, name, avatar_url
  FROM public.users;
