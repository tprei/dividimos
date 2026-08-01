import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  createTestUser,
  createTestGroupWithMembers,
  createAndActivateExpense,
  authenticateAs,
  deleteTestExpenses,
  type TestUser,
} from "@/test/integration-helpers";

const databaseUrl = process.env.SUPABASE_DB_URL;

/**
 * Issue #495: `20260806500000_payer_reachability_repair.sql` is a one-shot
 * forward migration -- it already ran once, against a clean database with
 * zero orphan payers, and its DO block is therefore a no-op every time
 * `supabase db reset` replays migration history. That means its two real
 * repair branches (draft delete, active/settled zero-share insert) and its
 * anomaly-abort branch have never actually executed against real
 * corruption anywhere in this repo's test suite.
 *
 * The composite `expense_payers_participant_fkey` (DEFERRABLE INITIALLY
 * DEFERRED) added right after this migration means a genuinely orphaned
 * payer can never again be a *committed* fact: any transaction that
 * leaves one uncorrected is rejected at commit. Per #495 spec items 16-19
 * ("Seed a persisted orphan only inside a rollback-only superuser
 * transaction while production guards/constraint enforcement are
 * temporarily bypassed... Restore all guards and constraints before
 * invoking the real activation body... Never run activation while
 * enforcement remains disabled"), every fixture below seeds corruption
 * and replays the exact migration SQL text inside one never-committed,
 * always-rolled-back transaction on a raw superuser connection.
 *
 * Every direct-token mutation here (both the seeding step and the
 * migration's own repair) explicitly bumps `graph_revision` itself while
 * its token is still open, exactly as every named-token RPC (e.g.
 * `activate_saved_expense`) does. #477's deferred one-shot finalizer only
 * auto-bumps a 'direct' token that reaches commit *still open*; a
 * manually `close_token`-ed 'direct' token (required here so a second
 * 'direct' token can open afterward -- only one may be open at a time)
 * would otherwise make the finalizer's own revision UPDATE fail the
 * guard's "no open token for expense" check when it eventually fires.
 * `SET CONSTRAINTS ALL IMMEDIATE` forces each token's finalizer to run,
 * inside this same rolled-back transaction, so results are observable
 * before the final ROLLBACK.
 */
function readRepairMigrationSql(): string {
  const here = fileURLToPath(import.meta.url);
  const repoRoot = here.slice(0, here.indexOf("/src/"));
  return readFileSync(
    `${repoRoot}/supabase/migrations/20260806500000_payer_reachability_repair.sql`,
    "utf8",
  );
}

async function settleOpenDirectToken(pg: Client): Promise<void> {
  // Force the deferred finalizer to run now, while the 'direct' token is
  // still 'open' -- it auto-bumps graph_revision and marks its own token
  // 'closed' on success. A 'direct' token's caller may never bump
  // graph_revision itself (the guard rejects that inline), and the
  // finalizer's auto-bump requires an *open* token, so calling
  // `close_token` first (rather than settling via this) would strand it.
  //
  // Named, not ALL: unlike the repair migration itself (which always
  // runs *before* the composite FK exists), this test runs against the
  // fully-migrated database, where `expense_payers_participant_fkey`
  // already exists. `SET CONSTRAINTS ALL IMMEDIATE` would force that FK
  // too, rejecting the still-orphaned seed state before the repair gets
  // a chance to fix it. Naming only the finalizer trigger settles
  // exactly the mechanism under test.
  await pg.query("SET CONSTRAINTS deferred_finalize_expense_graph_tokens IMMEDIATE");
  // SET CONSTRAINTS changes checking timing for the rest of the
  // transaction, not just a one-time flush -- leaving it IMMEDIATE would
  // make the *next* token's own INSERT fire its finalizer synchronously,
  // before that token's target rows are even registered, so the
  // finalizer would see zero events and immediately self-close it as a
  // no-op. Restore DEFERRED so later tokens behave normally again.
  await pg.query("SET CONSTRAINTS deferred_finalize_expense_graph_tokens DEFERRED");
}

/**
 * Deletes an expense_shares row while suppressing its ON DELETE CASCADE
 * to expense_payers. Cascade *actions* fire immediately regardless of a
 * DEFERRABLE FK's own check timing, so a plain delete would remove Bob's
 * payer row in the same statement -- making it impossible to construct
 * the "payer survives, share does not" orphan these fixtures need.
 * `session_replication_role = replica` is used rather than disabling the
 * RI trigger by name (PostgreSQL refuses `ALTER TABLE ... DISABLE
 * TRIGGER` on a system-generated constraint trigger even for a
 * superuser). Replica mode also suppresses #477's own guard/collector
 * triggers for this one statement, so the direct token's event-count
 * bookkeeping (`pg_temp.expense_graph_targets`, a session-owned temp
 * table with no special protection) is incremented directly afterward --
 * exactly what the collector trigger would otherwise have done.
 */
async function deleteShareBypassingCascade(
  pg: Client,
  expenseId: string,
  userId: string,
): Promise<void> {
  await pg.query("SET session_replication_role = replica");
  try {
    await pg.query(
      "delete from public.expense_shares where expense_id = $1 and user_id = $2",
      [expenseId, userId],
    );
  } finally {
    await pg.query("SET session_replication_role = DEFAULT");
  }
  await pg.query(
    `update pg_temp.expense_graph_targets
        set event_count = event_count + 1
      where expense_id = $1
        and mutation_token = (
          select mutation_token from pg_temp.expense_graph_tokens
           where source = 'direct' and state = 'open'
        )`,
    [expenseId],
  );
}

describe.skipIf(!isIntegrationTestReady)("payer_reachability_repair migration (#495)", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;
  const repairSql = readRepairMigrationSql();

  beforeAll(async () => {
    [alice, bob, carol] = await Promise.all([
      createTestUser({ name: "Payer Repair Alice" }),
      createTestUser({ name: "Payer Repair Bob" }),
      createTestUser({ name: "Payer Repair Carol" }),
    ]);
    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;
  });

  it("deletes an orphan payer row on a draft, leaving reachable rows untouched", async () => {
    const creatorClient = authenticateAs(alice);
    const { data: saveResult, error: saveError } = await creatorClient.rpc(
      "save_expense_draft_graph",
      {
        p_expense: {
          group_id: groupId,
          title: "Draft repair fixture",
          merchant_name: null,
          expense_type: "single_amount",
          total_amount: 1000,
          service_fee_basis_points: 0,
          fixed_fees: 0,
        },
        p_items: [],
        p_shares: [
          { user_id: alice.id, share_amount_cents: 500 },
          { user_id: bob.id, share_amount_cents: 500 },
        ],
        p_payers: [{ user_id: bob.id, amount_cents: 1000 }],
        p_guests: [],
        p_guest_shares: [],
        p_participant_order: [],
        p_expected_graph_revision: 0,
        p_save_operation_id: crypto.randomUUID(),
      },
    );
    expect(saveError).toBeNull();
    const expenseId = (saveResult as { id: string }).id;

    const pg = new Client(databaseUrl!);
    await pg.connect();
    try {
      await pg.query("BEGIN");
      // Simulate the pre-#495 bug directly: remove Bob's share while
      // leaving his payer row, exactly as the old save RPC's
      // delete-without-reachability-check path could produce.
      await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [
        [expenseId],
      ]);
      await deleteShareBypassingCascade(pg, expenseId, bob.id);
      await settleOpenDirectToken(pg);

      const beforePayer = await pg.query(
        "select count(*)::int as n from public.expense_payers where expense_id = $1 and user_id = $2",
        [expenseId, bob.id],
      );
      expect(beforePayer.rows[0].n).toBe(1);

      // Re-execute the exact migration SQL against this real corruption.
      await pg.query(repairSql);
      await settleOpenDirectToken(pg);

      const afterPayers = await pg.query(
        "select count(*)::int as n from public.expense_payers where expense_id = $1 and user_id = $2",
        [expenseId, bob.id],
      );
      expect(afterPayers.rows[0].n).toBe(0);

      // Alice's share and the expense parent are untouched.
      const aliceShare = await pg.query(
        "select share_amount_cents from public.expense_shares where expense_id = $1 and user_id = $2",
        [expenseId, alice.id],
      );
      expect(aliceShare.rows).toHaveLength(1);
      expect(aliceShare.rows[0].share_amount_cents).toBe(500);
    } finally {
      await pg.query("ROLLBACK").catch(() => {});
      await pg.end();
    }
  });

  it("inserts a zero-cent share at the existing allocation entity for an active orphan payer", async () => {
    const expenseId = await createAndActivateExpense({
      creator: alice,
      groupId,
      shares: [
        { userId: alice.id, amount: 500 },
        { userId: bob.id, amount: 500 },
      ],
      payers: [{ userId: bob.id, amount: 1000 }],
    });

    const pg = new Client(databaseUrl!);
    await pg.connect();
    try {
      const before = await pg.query<{ graph_revision: number }>(
        "select graph_revision from public.expenses where id = $1",
        [expenseId],
      );
      const startingRevision = before.rows[0].graph_revision;

      await pg.query("BEGIN");
      // Simulate the pre-#495 bug on an activated expense: Bob's user
      // allocation entity (#468's activation-time map) and his payer row
      // both survive, but his live share row is gone -- the exact
      // "removed group member remains the full payer" scenario the issue
      // body describes.
      await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [
        [expenseId],
      ]);
      await deleteShareBypassingCascade(pg, expenseId, bob.id);

      const entityBefore = await pg.query(
        "select participant_index from public.expense_allocation_entities where expense_id = $1 and entity_kind = 'user' and user_id = $2",
        [expenseId, bob.id],
      );
      expect(entityBefore.rows).toHaveLength(1);
      const entityIndex = entityBefore.rows[0].participant_index;

      await settleOpenDirectToken(pg);

      await pg.query(repairSql);
      await settleOpenDirectToken(pg);

      const repairedShare = await pg.query(
        "select share_amount_cents from public.expense_shares where expense_id = $1 and user_id = $2",
        [expenseId, bob.id],
      );
      expect(repairedShare.rows).toHaveLength(1);
      expect(repairedShare.rows[0].share_amount_cents).toBe(0);

      // The payer row, the allocation entity, and its index are all
      // unchanged -- the repair never reverses or recomputes the ledger.
      const payer = await pg.query(
        "select amount_cents from public.expense_payers where expense_id = $1 and user_id = $2",
        [expenseId, bob.id],
      );
      expect(payer.rows).toHaveLength(1);
      expect(payer.rows[0].amount_cents).toBe(1000);

      const entityAfter = await pg.query(
        "select participant_index from public.expense_allocation_entities where expense_id = $1 and entity_kind = 'user' and user_id = $2",
        [expenseId, bob.id],
      );
      expect(entityAfter.rows[0].participant_index).toBe(entityIndex);

      // Two direct mutations landed in this transaction (the seeding
      // delete, then the repair insert): exactly two revision bumps.
      const after = await pg.query<{ graph_revision: number }>(
        "select graph_revision from public.expenses where id = $1",
        [expenseId],
      );
      expect(after.rows[0].graph_revision).toBe(startingRevision + 2);
    } finally {
      await pg.query("ROLLBACK").catch(() => {});
      await pg.end();
    }
  });

  it("aborts without mutating anything when an orphan payer has no backing allocation entity", async () => {
    const expenseId = await createAndActivateExpense({
      creator: alice,
      groupId,
      shares: [
        { userId: alice.id, amount: 500 },
        { userId: bob.id, amount: 500 },
      ],
      payers: [{ userId: bob.id, amount: 1000 }],
    });

    const pg = new Client(databaseUrl!);
    await pg.connect();
    try {
      const before = await pg.query<{ graph_revision: number }>(
        "select graph_revision from public.expenses where id = $1",
        [expenseId],
      );
      const startingRevision = before.rows[0].graph_revision;

      await pg.query("BEGIN");
      // A genuine anomaly: Carol was never a participant of this expense
      // at all -- no share, no allocation entity, no balance edges -- so
      // inserting a raw payer row for her (the FK is deferred, so this is
      // not yet rejected) has zero backing #468 activation-time
      // provenance. Unlike corrupting Bob's already-consistent entity,
      // this leaves every existing #477 debt/credit invariant untouched,
      // so settling this token only exercises the repair's own
      // reachability check, not an unrelated pre-existing one.
      await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [
        [expenseId],
      ]);
      await pg.query(
        "insert into public.expense_payers (expense_id, user_id, amount_cents) values ($1, $2, 500)",
        [expenseId, carol.id],
      );
      await settleOpenDirectToken(pg);

      const seeded = await pg.query(
        "select count(*)::int as n from public.expense_payers where expense_id = $1 and user_id = $2",
        [expenseId, carol.id],
      );
      expect(seeded.rows[0].n).toBe(1);

      await pg.query("SAVEPOINT before_repair");
      await expect(pg.query(repairSql)).rejects.toThrow(/anomaly/);
      // An uncaught exception aborts the whole transaction, not just the
      // one statement; roll back to the savepoint to keep verifying
      // within the same still-open, still-rollback-only transaction.
      await pg.query("ROLLBACK TO SAVEPOINT before_repair");

      // The failed repair statement rolled back on its own (an uncaught
      // exception aborts only that statement); Carol's orphan payer is
      // exactly as it was, and no further revision bump landed.
      const stillOrphaned = await pg.query(
        "select count(*)::int as n from public.expense_payers where expense_id = $1 and user_id = $2",
        [expenseId, carol.id],
      );
      expect(stillOrphaned.rows[0].n).toBe(1);

      const after = await pg.query<{ graph_revision: number }>(
        "select graph_revision from public.expenses where id = $1",
        [expenseId],
      );
      expect(after.rows[0].graph_revision).toBe(startingRevision + 1);
    } finally {
      await pg.query("ROLLBACK").catch(() => {});
      await pg.end();
    }
  });

  it("repairs two distinct orphaned drafts in a single migration replay", async () => {
    // This is the scenario the SET CONSTRAINTS ALL IMMEDIATE / DEFERRED
    // pairing exists for: the migration's loop opens and settles one
    // 'direct' token per orphan expense. Without restoring DEFERRED after
    // each settle, the *second* token's own INSERT would fire its
    // finalizer synchronously before that token's target row is even
    // registered, misreading it as a zero-event no-op and closing it
    // before its DML ever runs -- exactly the bug this fixture proves is
    // fixed.
    async function createOrphanedDraft(): Promise<string> {
      const creatorClient = authenticateAs(alice);
      const { data: saveResult, error: saveError } = await creatorClient.rpc(
        "save_expense_draft_graph",
        {
          p_expense: {
            group_id: groupId,
            title: "Multi-orphan repair fixture",
            merchant_name: null,
            expense_type: "single_amount",
            total_amount: 1000,
            service_fee_basis_points: 0,
            fixed_fees: 0,
          },
          p_items: [],
          p_shares: [
            { user_id: alice.id, share_amount_cents: 500 },
            { user_id: bob.id, share_amount_cents: 500 },
          ],
          p_payers: [{ user_id: bob.id, amount_cents: 1000 }],
          p_guests: [],
          p_guest_shares: [],
          p_participant_order: [],
          p_expected_graph_revision: 0,
          p_save_operation_id: crypto.randomUUID(),
        },
      );
      expect(saveError).toBeNull();
      return (saveResult as { id: string }).id;
    }

    const expenseIdA = await createOrphanedDraft();
    const expenseIdB = await createOrphanedDraft();

    const pg = new Client(databaseUrl!);
    await pg.connect();
    try {
      await pg.query("BEGIN");
      for (const expenseId of [expenseIdA, expenseIdB]) {
        await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [
          [expenseId],
        ]);
        await deleteShareBypassingCascade(pg, expenseId, bob.id);
        await settleOpenDirectToken(pg);
      }

      const beforeCount = await pg.query(
        "select count(*)::int as n from public.expense_payers where expense_id = any($1::uuid[]) and user_id = $2",
        [[expenseIdA, expenseIdB], bob.id],
      );
      expect(beforeCount.rows[0].n).toBe(2);

      await pg.query(repairSql);
      await settleOpenDirectToken(pg);

      const afterCount = await pg.query(
        "select count(*)::int as n from public.expense_payers where expense_id = any($1::uuid[]) and user_id = $2",
        [[expenseIdA, expenseIdB], bob.id],
      );
      expect(afterCount.rows[0].n).toBe(0);
    } finally {
      await pg.query("ROLLBACK").catch(() => {});
      await pg.end();
    }
  });
});

describe.skipIf(!isIntegrationTestReady)(
  "activate_saved_expense rejects a corrupt persisted draft (#495)",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let groupId: string;

    beforeAll(async () => {
      [alice, bob] = await Promise.all([
        createTestUser({ name: "Activation Orphan Alice" }),
        createTestUser({ name: "Activation Orphan Bob" }),
      ]);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;
    });

    it("returns PST07/orphan_payer_state and performs no activation when the persisted draft has an orphan payer", async () => {
      const creatorClient = authenticateAs(alice);
      const { data: saveResult, error: saveError } = await creatorClient.rpc(
        "save_expense_draft_graph",
        {
          p_expense: {
            group_id: groupId,
            title: "Orphan activation rejection fixture",
            merchant_name: null,
            expense_type: "single_amount",
            total_amount: 1000,
            service_fee_basis_points: 0,
            fixed_fees: 0,
          },
          p_items: [],
          p_shares: [
            { user_id: alice.id, share_amount_cents: 500 },
            { user_id: bob.id, share_amount_cents: 500 },
          ],
          p_payers: [{ user_id: bob.id, amount_cents: 1000 }],
          p_guests: [],
          p_guest_shares: [],
          p_participant_order: [],
          p_expected_graph_revision: 0,
          p_save_operation_id: crypto.randomUUID(),
        },
      );
      expect(saveError).toBeNull();
      const saved = saveResult as { id: string; graph_revision: number };
      const expenseId = saved.id;

      const pg = new Client(databaseUrl!);
      await pg.connect();
      try {
        await pg.query("BEGIN");
        // Corrupt the persisted draft directly: remove Bob's share,
        // leaving his payer row orphaned -- exactly what the pre-#495
        // save RPC's delete-without-reachability-check bug could
        // produce, and what the composite FK now prevents from ever
        // being a *committed* fact, so this only exists transiently
        // inside this never-committed transaction.
        await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [
          [expenseId],
        ]);
        await deleteShareBypassingCascade(pg, expenseId, bob.id);
        await settleOpenDirectToken(pg);

        // The seeding step's own 'direct' mutation legitimately bumped
        // graph_revision once (exactly as it would for a real prior
        // transaction that produced this corruption); read the current
        // value back so the activation call's CAS check reflects reality
        // rather than racing a revision the corruption itself advanced.
        const corrupted = await pg.query<{ graph_revision: number }>(
          "select graph_revision from public.expenses where id = $1",
          [expenseId],
        );
        const corruptedRevision = corrupted.rows[0].graph_revision;

        // Call the real activate_saved_expense RPC as the real creator,
        // on this same connection, so the corruption is visible to it
        // without ever having been committed. auth.uid() reads
        // request.jwt.claim.sub; SECURITY DEFINER functions run with the
        // definer's privileges regardless of calling role, so no role
        // switch is needed to reach this owner-defined function.
        await pg.query("select set_config('request.jwt.claim.sub', $1, true)", [alice.id]);

        await expect(
          pg.query("select public.activate_saved_expense($1, $2)", [
            expenseId,
            corruptedRevision,
          ]),
        ).rejects.toThrow(/orphan_payer_state/);
      } finally {
        await pg.query("ROLLBACK").catch(() => {});
        await pg.end();
      }

      // Outside the rolled-back transaction, on a fresh connection:
      // nothing committed. The draft is exactly as it was before the
      // corrupted activation attempt -- still draft, no allocation
      // entities, unchanged revision -- because the rejected activation
      // never got the chance to write anything, and the corruption
      // itself was never committed either.
      const verify = new Client(databaseUrl!);
      await verify.connect();
      try {
        const after = await verify.query<{ status: string; graph_revision: number }>(
          "select status, graph_revision from public.expenses where id = $1",
          [expenseId],
        );
        expect(after.rows[0].status).toBe("draft");
        expect(after.rows[0].graph_revision).toBe(saved.graph_revision);

        const entities = await verify.query<{ n: number }>(
          "select count(*)::int as n from public.expense_allocation_entities where expense_id = $1",
          [expenseId],
        );
        expect(entities.rows[0].n).toBe(0);

        const bobShare = await verify.query(
          "select share_amount_cents from public.expense_shares where expense_id = $1 and user_id = $2",
          [expenseId, bob.id],
        );
        expect(bobShare.rows).toHaveLength(1);
        expect(bobShare.rows[0].share_amount_cents).toBe(500);
      } finally {
        await verify.end();
      }
    });
  },
);

describe.skipIf(!isIntegrationTestReady)(
  "save_expense_draft_graph rejects a corrupt persisted draft before considering the replacement (#495)",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let groupId: string;

    beforeAll(async () => {
      [alice, bob] = await Promise.all([
        createTestUser({ name: "Save Orphan Alice" }),
        createTestUser({ name: "Save Orphan Bob" }),
      ]);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;
    });

    it("returns PST07/orphan_payer_state and performs no replacement when the existing persisted draft has an orphan payer", async () => {
      const creatorClient = authenticateAs(alice);
      const { data: saveResult, error: saveError } = await creatorClient.rpc(
        "save_expense_draft_graph",
        {
          p_expense: {
            group_id: groupId,
            title: "Orphan save-replacement rejection fixture",
            merchant_name: null,
            expense_type: "single_amount",
            total_amount: 1000,
            service_fee_basis_points: 0,
            fixed_fees: 0,
          },
          p_items: [],
          p_shares: [
            { user_id: alice.id, share_amount_cents: 500 },
            { user_id: bob.id, share_amount_cents: 500 },
          ],
          p_payers: [{ user_id: bob.id, amount_cents: 1000 }],
          p_guests: [],
          p_guest_shares: [],
          p_participant_order: [],
          p_expected_graph_revision: 0,
          p_save_operation_id: crypto.randomUUID(),
        },
      );
      expect(saveError).toBeNull();
      const saved = saveResult as { id: string; graph_revision: number };
      const expenseId = saved.id;

      const pg = new Client(databaseUrl!);
      await pg.connect();
      try {
        await pg.query("BEGIN");
        // Corrupt the persisted draft, exactly as in the activation
        // fixture above.
        await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [
          [expenseId],
        ]);
        await deleteShareBypassingCascade(pg, expenseId, bob.id);
        await settleOpenDirectToken(pg);

        const corrupted = await pg.query<{ graph_revision: number }>(
          "select graph_revision from public.expenses where id = $1",
          [expenseId],
        );
        const corruptedRevision = corrupted.rows[0].graph_revision;

        // Attempt a well-formed replacement save (e.g. renaming the
        // title) through the real RPC as the real creator, on this same
        // connection. A valid incoming graph must not silently repair
        // the persisted orphan -- it must be rejected before the
        // replacement is ever considered.
        await pg.query("select set_config('request.jwt.claim.sub', $1, true)", [alice.id]);

        await expect(
          pg.query(
            `select public.save_expense_draft_graph(
               $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9
             )`,
            [
              JSON.stringify({
                id: expenseId,
                group_id: groupId,
                title: "Renamed after corruption",
                merchant_name: null,
                expense_type: "single_amount",
                total_amount: 1000,
                service_fee_basis_points: 0,
                fixed_fees: 0,
              }),
              JSON.stringify([]),
              JSON.stringify([
                { user_id: alice.id, share_amount_cents: 500 },
                { user_id: bob.id, share_amount_cents: 500 },
              ]),
              JSON.stringify([{ user_id: bob.id, amount_cents: 1000 }]),
              JSON.stringify([]),
              JSON.stringify([]),
              JSON.stringify([]),
              corruptedRevision,
              crypto.randomUUID(),
            ],
          ),
        ).rejects.toThrow(/orphan_payer_state/);
      } finally {
        await pg.query("ROLLBACK").catch(() => {});
        await pg.end();
      }

      // Nothing committed: title is unchanged, Bob's share (which the
      // corruption removed) is back per the rollback, revision unchanged.
      const verify = new Client(databaseUrl!);
      await verify.connect();
      try {
        const after = await verify.query<{ title: string; graph_revision: number }>(
          "select title, graph_revision from public.expenses where id = $1",
          [expenseId],
        );
        expect(after.rows[0].title).toBe("Orphan save-replacement rejection fixture");
        expect(after.rows[0].graph_revision).toBe(saved.graph_revision);

        const bobShare = await verify.query(
          "select share_amount_cents from public.expense_shares where expense_id = $1 and user_id = $2",
          [expenseId, bob.id],
        );
        expect(bobShare.rows).toHaveLength(1);
        expect(bobShare.rows[0].share_amount_cents).toBe(500);
      } finally {
        await verify.end();
      }
    });
  },
);

describe.skipIf(!isIntegrationTestReady)(
  "expense_payers_participant_fkey direct-connection behavior (#495)",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let groupId: string;
    let pg: Client;
    const createdExpenseIds: string[] = [];

    beforeAll(async () => {
      pg = new Client(databaseUrl!);
      await pg.connect();
      [alice, bob] = await Promise.all([
        createTestUser({ name: "FK Direct Alice" }),
        createTestUser({ name: "FK Direct Bob" }),
      ]);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;
    });

    afterAll(async () => {
      if (createdExpenseIds.length > 0) {
        await deleteTestExpenses(pg, createdExpenseIds);
      }
      await pg.end();
    });

    it("rejects a direct orphan payer insert with exact SQLSTATE 23503 and constraint name when forced immediate", async () => {
      const creatorClient = authenticateAs(alice);
      const { data: saveResult, error: saveError } = await creatorClient.rpc(
        "save_expense_draft_graph",
        {
          p_expense: {
            group_id: groupId,
            title: "FK direct-insert rejection fixture",
            merchant_name: null,
            expense_type: "single_amount",
            total_amount: 500,
            service_fee_basis_points: 0,
            fixed_fees: 0,
          },
          p_items: [],
          p_shares: [{ user_id: alice.id, share_amount_cents: 500 }],
          p_payers: [{ user_id: alice.id, amount_cents: 500 }],
          p_guests: [],
          p_guest_shares: [],
          p_participant_order: [],
          p_expected_graph_revision: 0,
          p_save_operation_id: crypto.randomUUID(),
        },
      );
      expect(saveError).toBeNull();
      const expenseId = (saveResult as { id: string }).id;
      createdExpenseIds.push(expenseId);

      await pg.query("BEGIN");
      try {
        await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [
          [expenseId],
        ]);
        // Set only this one constraint immediate -- not ALL -- exactly
        // as the spec directs, so the assertion below can only be
        // satisfied by this exact named FK, not some other guard/ACL
        // error that happened to also be forced immediate.
        await pg.query("SET CONSTRAINTS expense_payers_participant_fkey IMMEDIATE");

        let caught: { code?: string; constraint?: string } | undefined;
        try {
          await pg.query(
            "insert into public.expense_payers (expense_id, user_id, amount_cents) values ($1, $2, 500)",
            [expenseId, bob.id],
          );
        } catch (error) {
          caught = error as { code?: string; constraint?: string };
        }
        expect(caught).toBeDefined();
        expect(caught!.code).toBe("23503");
        expect(caught!.constraint).toBe("expense_payers_participant_fkey");
      } finally {
        await pg.query("ROLLBACK").catch(() => {});
      }
    });

    it("cascades a share delete to its payer, compacts nothing else, and bumps revision once", async () => {
      const creatorClient = authenticateAs(alice);
      const { data: saveResult, error: saveError } = await creatorClient.rpc(
        "save_expense_draft_graph",
        {
          p_expense: {
            group_id: groupId,
            title: "FK cascade fixture",
            merchant_name: null,
            expense_type: "itemized",
            total_amount: 1000,
            service_fee_basis_points: 0,
            fixed_fees: 0,
          },
          p_items: [
            { description: "Pizza", quantity: 1000, unit_price_cents: 1000, total_price_cents: 1000 },
          ],
          p_shares: [
            { user_id: alice.id, share_amount_cents: 500 },
            { user_id: bob.id, share_amount_cents: 500 },
          ],
          p_payers: [{ user_id: bob.id, amount_cents: 1000 }],
          p_guests: [],
          p_guest_shares: [],
          p_participant_order: [],
          p_expected_graph_revision: 0,
          p_save_operation_id: crypto.randomUUID(),
        },
      );
      expect(saveError).toBeNull();
      const saved = saveResult as { id: string; graph_revision: number };
      const expenseId = saved.id;
      createdExpenseIds.push(expenseId);

      await pg.query("BEGIN");
      await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [
        [expenseId],
      ]);
      // A plain delete this time -- no cascade-suppression trick -- to
      // observe the FK's ON DELETE CASCADE fire for real, as a
      // committable fact rather than a corruption fixture.
      await pg.query(
        "delete from public.expense_shares where expense_id = $1 and user_id = $2",
        [expenseId, bob.id],
      );
      await settleOpenDirectToken(pg);
      await pg.query("COMMIT");

      const bobShare = await pg.query(
        "select 1 from public.expense_shares where expense_id = $1 and user_id = $2",
        [expenseId, bob.id],
      );
      expect(bobShare.rows).toHaveLength(0);

      const bobPayer = await pg.query(
        "select 1 from public.expense_payers where expense_id = $1 and user_id = $2",
        [expenseId, bob.id],
      );
      expect(bobPayer.rows).toHaveLength(0);

      const aliceShare = await pg.query(
        "select share_amount_cents from public.expense_shares where expense_id = $1 and user_id = $2",
        [expenseId, alice.id],
      );
      expect(aliceShare.rows).toHaveLength(1);
      expect(aliceShare.rows[0].share_amount_cents).toBe(500);

      const after = await pg.query<{ graph_revision: number }>(
        "select graph_revision from public.expenses where id = $1",
        [expenseId],
      );
      expect(after.rows[0].graph_revision).toBe(saved.graph_revision + 1);
    });
  },
);
