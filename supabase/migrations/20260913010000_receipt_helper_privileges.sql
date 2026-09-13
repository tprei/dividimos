-- lock_receipt_key was created without an explicit ACL, so every database
-- built from migrations kept PostgreSQL's default PUBLIC execute grant for it.
-- The helper is called only inside SECURITY DEFINER ledger RPCs; browser roles
-- have no business executing it directly. Revoke browser access explicitly and
-- keep service-role execution (the bulk grant in the baseline covers tables
-- and sequences only for this role on functions created later).
REVOKE ALL ON FUNCTION public.lock_receipt_key(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_receipt_key(uuid, text) TO service_role;
