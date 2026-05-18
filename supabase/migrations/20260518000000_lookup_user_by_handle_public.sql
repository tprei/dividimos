-- Allow unauthenticated visitors to look up a single profile by exact handle.
-- The function is SECURITY DEFINER and returns only (id, handle, name, avatar_url)
-- for one row at a time, so there is no enumeration risk: the caller must already
-- know the exact handle to get any result.
GRANT EXECUTE ON FUNCTION public.lookup_user_by_handle(TEXT) TO anon;
