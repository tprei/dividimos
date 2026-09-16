# Writing SQL migrations

Rules for authoring and reviewing changes under `supabase/migrations/`. Read this before writing or reviewing any migration, forward fix, or schema change.

## History is immutable

- A migration file that has landed on `main` (or been applied to any shared database) is frozen. Never edit, rename, reformat, or delete it, not even for whitespace.
- Corrections to a landed migration are new forward migrations that carry the complete corrected definition.
- `supabase migration repair` only edits history metadata. It is not rollback and executes nothing. Do not use it to make a failed upgrade look applied.
- There is no `migration down`. To undo a deployed behavior, write a new forward corrective migration with the reviewed previous definition or a compensating data operation, and test it as an upgrade.

## File naming and sequencing

- Names are `<14-digit UTC timestamp>_<short_description>.sql`, for example `20260913010100_guest_credential_locking.sql`. The description carries at least two lowercase words and never a bare issue number: `20260911000100_748_716a.sql` is what not to write, because the name says nothing about what the migration does. Frozen predecessors keep their names; the rule binds new files only.
- Every migration in the directory must have a unique 14-digit version, and newly added versions must sort after the greatest version already on `main`.
- One coherent behavior change per migration. Do not bundle unrelated schema, security, and backfill work.
- The initial first-install sequence (when it exists) is dependency-ordered and domain-grouped: schemas and types, tables and constraints and RLS, helpers, serializers, public RPCs, Auth triggers and Realtime. An object is introduced in its final reviewed form; there is no create-then-repair chronology inside it.

## Authoring rules

- Write complete object definitions. A migration that changes a function ships the full `CREATE OR REPLACE FUNCTION` body, not a source-text patch or a partial column list.
- A signature change is a parallel change across two migrations, because shipped Capacitor Android builds cannot be force-updated and an installed client keeps calling the old signature after the server moves. One migration adds the new signature; a later migration, after a release in which no installed client calls it, removes the old overload with `DROP FUNCTION` and exact argument types. The removing migration carries `-- supersedes: <signature> introduced <version>` naming the migration that landed the replacement.
- Schema-qualify every object (`public.foo`, `guest_credentials.claim_tokens`). Never rely on `search_path` resolution.
- Set a safe explicit `search_path` on every function (`SET search_path = public, pg_temp` or narrower). A nonempty string alone is not proof; the paths must actually be safe.
- Every function definition carries its own explicit privileges in the same file: `REVOKE ALL ... FROM PUBLIC` plus grants to the intended roles. Do not rely on a late bulk revoke or on `ALTER DEFAULT PRIVILEGES`; PostgreSQL grants PUBLIC execution on functions by default and per-function ACLs are the only reliable control.
- Use explicit insert column lists. Never rely on column order.
- Prefer static SQL. Dynamic SQL (`EXECUTE format(...)`) needs a justification comment-level explanation in review, and identifiers must be quoted.
- Money is integer centavos; quantities are integer milliunits. Fees are nonnegative half-up integer basis-point rounding of `subtotal * basisPoints / 10_000`. Never introduce floating point or a second rounding convention.
- Domain errors are stable codes (`stale_version`, `invalid_token`, `group_has_history`, ...). Do not invent near-duplicates or reword them in SQL.
- Backfills must be derivable from stored evidence. If a fact cannot be reconstructed, record the limitation rather than inventing history.
- DDL and data backfill never share a file. A backfill is its own migration, derived from stored evidence, and safe to re-run.

### Table DDL

These four lines apply to table DDL only, not to the function-replacement migrations that make up nearly all of this repo's history.

- `SET lock_timeout = '5s'` is the first statement, so a blocked `ALTER TABLE` fails instead of queueing behind a long read and freezing every writer behind it.
- Constraints land `NOT VALID`, then a later `VALIDATE CONSTRAINT` scans without holding a write lock.
- `SET NOT NULL` follows a validated check constraint on the same column; a bare `SET NOT NULL` scans the table under an exclusive lock.
- `ADD COLUMN` carries no volatile default (`now()`, `gen_random_uuid()`, `random()`): add the column nullable, backfill separately, then set the default.

## Financial RPC order

Every mutating ledger RPC follows one order:

1. Identify the caller from Auth (`auth.uid()`); never trust caller identity from arguments.
2. Acquire locks in the established consistent order (receipt-key locks before group locks; group before guest before credential rows) so concurrent RPCs serialize the same way.
3. Under those locks, recheck authorization, membership, lifecycle, and state.
4. Validate the payload exactly (money, limits, array shapes) before writing facts.
5. Write facts (`expenses`, `expense_versions`, `settlements`).
6. Recompute `group_balances` in the same transaction via `recompute_group_balances(group)`.
7. Emit the event/broadcast.
8. Return the response shape the client already decodes.

Operations that cannot run inside a single transaction (external calls, push dispatch) are separate, explicitly marked, and never silently half-committed.

## Verification

- Run the static gate first, because it costs a second and the replay jobs cost forty minutes: `npm run check:migrations -- supabase/migrations/<your-file>.sql`.
- Inspect the current live definition before editing: `select pg_get_functiondef('public.foo(argtypes)'::regprocedure);`
- Apply locally with the pinned project binary (`./node_modules/.bin/supabase migration up --local`), never a global CLI of a different version.
- Run the focused behavior coverage for anything you touched: migration changes with semantic logic require integration tests (happy path, denial for non-members, the specific guarded edge).
- Regenerate `src/types/database.ts` from the final live database when contracts change; never hand-maintain it.
- The blocking gates are fresh replay, trusted-epoch comparison, generated-type equality, the integration contract suite, and the security/privilege check. A migration is not done until all required gates pass against the change.
- `CREATE INDEX CONCURRENTLY` is not expressible in a CLI-applied migration. It succeeds under `supabase db reset` but fails under `supabase migration up --local` with `CREATE INDEX CONCURRENTLY cannot be executed within a pipeline (SQLSTATE 25001)`, which is the path the upgrade and epoch gates use. Build a concurrent index out of band once a table is large enough for the lock to matter.

## Migration workflow

The ordered files in `supabase/migrations/` are the database source of truth. Create a new timestamped migration with `supabase migration new <name>`, write complete definitions, and run `supabase db reset --local` to replay the full history. The CI migration workflow verifies fresh replay, the trusted reset manifest, generated types, integration behavior, and database security invariants. The retired `supabase/schemas/` declarations and `supabase/schema.sql` snapshot are not inputs.

These rules govern newly authored SQL. Do not rename, reformat, or repair frozen predecessor files to satisfy them; existing defects belong to their named forward-fix PRs.

## Recovery vocabulary

Three distinct operations; do not conflate them:

- Disposable rebuild: `supabase db reset --local` destroys local data and replays known history.
- Corrective migration: new forward migration that supersedes a deployed behavior.
- Data restore: restore a backup/PITR into an isolated project and coordinate cutback. SQL reversal does not reconstruct deleted data.
