import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { isIntegrationTestReady } from "@/test/integration-setup";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

// This test observes real cross-connection PostgreSQL advisory-lock
// contention (pg_locks state on the *server*, not anything the client
// process can await deterministically). Following the same precedent as
// src/test/db-race-barrier.ts's forceLockContentionRace, a short bounded
// poll loop is the only way to detect that another live database session
// is genuinely waiting on the lock; it is not standing in for a fake
// timer over code under test.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function insertThrowawayAuthUser(client: Client, id: string, email: string): Promise<void> {
  await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change_token_new, email_change
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
       'x', now(), '{}'::jsonb, now(), now(), '', '', '', ''
     )`,
    [id, email],
  );
}

describe.skipIf(!canRun)("financial compatibility gate (#477 preparatory)", () => {
  let pg: Client;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();
  });

  afterAll(async () => {
    if (!pg) return;
    // Always leave the gate open for every other suite in this shared
    // database, no matter which assertion below failed.
    await pg.query("select financial_internal.set_financial_maintenance(false)");
    await pg.end();
  });

  afterEach(async () => {
    await pg.query("select financial_internal.set_financial_maintenance(false)");
  });

  it("creates financial_internal.financial_compatibility_state RLS-locked with no policies", async () => {
    const { rows } = await pg.query(
      `select c.relrowsecurity as rls_on,
              exists(
                select 1 from pg_policies p
                where p.schemaname = 'financial_internal'
                  and p.tablename = 'financial_compatibility_state'
              ) as has_policy
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'financial_internal' and c.relname = 'financial_compatibility_state'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rls_on).toBe(true);
    expect(rows[0].has_policy).toBe(false);
  });

  it("revokes every privilege on the schema and table from PUBLIC/anon/authenticated/service_role", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const schemaUsage = await pg.query("select has_schema_privilege($1, 'financial_internal', 'USAGE') as has", [role]);
      expect(schemaUsage.rows[0].has).toBe(false);
      const tableSelect = await pg.query(
        "select has_table_privilege($1, 'financial_internal.financial_compatibility_state', 'SELECT') as has",
        [role],
      );
      expect(tableSelect.rows[0].has).toBe(false);
    }
  });

  it("never grants set_financial_maintenance to any PostgREST-exposed role, nor PUBLIC", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows } = await pg.query(
        "select has_function_privilege($1, 'financial_internal.set_financial_maintenance(boolean)', 'EXECUTE') as has",
        [role],
      );
      expect(rows[0].has).toBe(false);
    }

    // has_function_privilege has no special "PUBLIC" pseudo-role handling
    // (unlike GRANT/REVOKE); inspect the raw ACL for an unqualified
    // grantee entry (PostgreSQL's textual form for a PUBLIC grant, e.g.
    // "=X/owner") to prove the implicit CREATE FUNCTION default grant to
    // PUBLIC was actually revoked.
    const { rows } = await pg.query(
      `select coalesce(array_to_string(proacl, ','), '') as acl
         from pg_proc
        where proname = 'set_financial_maintenance'
          and pronamespace = 'financial_internal'::regnamespace`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].acl).not.toMatch(/(^|,)=/);
  });

  it("seeds the baseline singleton: not in maintenance, schema version 1, native version code 1", async () => {
    const { rows } = await pg.query(
      "select maintenance, required_schema_version, minimum_native_version_code from financial_internal.financial_compatibility_state where id = true",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].maintenance).toBe(false);
    expect(rows[0].required_schema_version).toBe(1);
    expect(rows[0].minimum_native_version_code).toBe(1);
  });

  it("allows ordinary account deletion to cascade while maintenance is closed", async () => {
    const id = "fc000000-0000-0000-0000-000000000001";
    await insertThrowawayAuthUser(pg, id, "fc-gate-open@test.dividimos.local");
    await expect(pg.query("delete from auth.users where id = $1", [id])).resolves.toBeDefined();
    const remaining = await pg.query("select 1 from public.users where id = $1", [id]);
    expect(remaining.rows).toHaveLength(0);
  });

  it("rejects account deletion with PST09/financial_maintenance while maintenance is open", async () => {
    const id = "fc000000-0000-0000-0000-000000000002";
    await insertThrowawayAuthUser(pg, id, "fc-gate-closed@test.dividimos.local");
    await pg.query("select financial_internal.set_financial_maintenance(true)");

    await expect(pg.query("delete from auth.users where id = $1", [id])).rejects.toMatchObject({
      code: "PST09",
    });

    await pg.query("select financial_internal.set_financial_maintenance(false)");
    await pg.query("delete from auth.users where id = $1", [id]);
  });

  it("rejects save_expense_draft_graph with PST09 before authentication is even checked, while maintenance is open", async () => {
    await pg.query("select financial_internal.set_financial_maintenance(true)");

    await expect(
      pg.query(
        "select public.save_expense_draft_graph(null, null, null, null, null, null, null, 0, gen_random_uuid())",
      ),
    ).rejects.toMatchObject({ code: "PST09" });

    await pg.query("select financial_internal.set_financial_maintenance(false)");

    // With maintenance closed, the same unauthenticated call now fails
    // for the next reason in body order: no caller.
    await expect(
      pg.query(
        "select public.save_expense_draft_graph(null, null, null, null, null, null, null, 0, gen_random_uuid())",
      ),
    ).rejects.toMatchObject({ code: "PST01" });
  });

  it("rejects activate_saved_expense with PST09 before authentication is even checked, while maintenance is open", async () => {
    await pg.query("select financial_internal.set_financial_maintenance(true)");

    await expect(
      pg.query("select public.activate_saved_expense(gen_random_uuid(), 0)"),
    ).rejects.toMatchObject({ code: "PST09" });

    await pg.query("select financial_internal.set_financial_maintenance(false)");

    await expect(
      pg.query("select public.activate_saved_expense(gen_random_uuid(), 0)"),
    ).rejects.toMatchObject({ code: "PST01" });
  });

  it("rejects claim_guest_spot with PST09 before authentication is even checked, while maintenance is open", async () => {
    await pg.query("select financial_internal.set_financial_maintenance(true)");

    // claim_guest_spot(text) now takes an opaque text token; PST09 (maintenance)
    // and PST01 (no auth on this raw pg connection) both fire before the token
    // is examined, so any well-typed text argument suffices (#581 cutover).
    await expect(pg.query("select public.claim_guest_spot('gst1_gate_probe')")).rejects.toMatchObject({
      code: "PST09",
    });

    await pg.query("select financial_internal.set_financial_maintenance(false)");

    await expect(pg.query("select public.claim_guest_spot('gst1_gate_probe')")).rejects.toMatchObject({
      code: "PST01",
    });
  });

  it("rejects load_expense_graph_snapshot with PST09 before authentication is even checked, while maintenance is open", async () => {
    await pg.query("select financial_internal.set_financial_maintenance(true)");

    await expect(
      pg.query("select public.load_expense_graph_snapshot(gen_random_uuid())"),
    ).rejects.toMatchObject({ code: "PST09" });

    await pg.query("select financial_internal.set_financial_maintenance(false)");

    await expect(
      pg.query("select public.load_expense_graph_snapshot(gen_random_uuid())"),
    ).rejects.toMatchObject({ code: "PST01" });
  });

  it(
    "drains an already-admitted deletion before closing: the maintenance setter blocks on the exclusive " +
      "advisory lock until the shared-lock-holding deletion transaction commits",
    async () => {
      const id = "fc000000-0000-0000-0000-000000000003";
      await insertThrowawayAuthUser(pg, id, "fc-gate-drain@test.dividimos.local");

      const holder = new Client(databaseUrl!);
      await holder.connect();
      const monitor = new Client(databaseUrl!);
      await monitor.connect();
      const setter = new Client(databaseUrl!);
      await setter.connect();

      try {
        // Holder begins the deletion but does not commit yet: the trigger
        // has already acquired advisory lock 477000001 SHARED and holds it
        // for the rest of this open transaction.
        await holder.query("BEGIN");
        await holder.query("delete from auth.users where id = $1", [id]);

        // Setter's exclusive acquisition must now block behind the holder.
        const setterPromise = setter.query("select financial_internal.set_financial_maintenance(true)");

        let observedWaiting = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          const { rows } = await monitor.query<{ waiting: boolean }>(
            `select exists(
               select 1 from pg_locks
               where locktype = 'advisory'
                 and not granted
                 and mode = 'ExclusiveLock'
                 and classid = 0
                 and objid = 477000001
             ) as waiting`,
          );
          if (rows[0]?.waiting) {
            observedWaiting = true;
            break;
          }
          await sleep(20);
        }
        expect(observedWaiting).toBe(true);

        // Committing releases the shared lock; the setter's exclusive
        // acquisition (and the flag flip) can now proceed.
        await holder.query("COMMIT");
        await setterPromise;

        const { rows } = await pg.query(
          "select maintenance from financial_internal.financial_compatibility_state where id = true",
        );
        expect(rows[0].maintenance).toBe(true);
      } finally {
        await holder.query("ROLLBACK").catch(() => {});
        await holder.end();
        await monitor.end();
        await setter.end();
        await pg.query("select financial_internal.set_financial_maintenance(false)");
        await pg.query("delete from auth.users where id = $1", [id]).catch(() => {});
      }
    },
  );
  // #505: leave_group / remove_group_member must take the #477 gate, raising
  // PST09 while maintenance is open — like every balance writer. The check
  // runs before auth, so an unauthenticated raw call is enough to prove it.
  it("rejects leave_group with PST09 while maintenance is open", async () => {
    await pg.query("select financial_internal.set_financial_maintenance(true)");
    await expect(
      pg.query("select public.leave_group($1)", [
        "00000000-0000-0000-0000-000000000099",
      ]),
    ).rejects.toMatchObject({ code: "PST09" });
  });

  it("rejects remove_group_member with PST09 while maintenance is open", async () => {
    await pg.query("select financial_internal.set_financial_maintenance(true)");
    await expect(
      pg.query("select public.remove_group_member($1, $2)", [
        "00000000-0000-0000-0000-000000000099",
        "00000000-0000-0000-0000-000000000098",
      ]),
    ).rejects.toMatchObject({ code: "PST09" });
  });
});
