/**
 * Issue #475: deterministic proof that `increment_rate_limit` is safe for a
 * brand-new (bucket, subject) key racing two concurrent transactions.
 *
 * The prior implementation performed `SELECT ... FOR UPDATE` (finds no row)
 * then `INSERT ... ON CONFLICT DO UPDATE`. PostgreSQL does not gap-lock an
 * absent row, so two concurrent cold-start transactions could both pass the
 * SELECT and both be admitted. Client-side timing (`Promise.all`) cannot
 * reliably force that overlap in a fast local/CI database, so this test
 * synchronizes at the database level instead: a test-only `BEFORE INSERT`
 * trigger blocks each racing transaction on an advisory-lock rendezvous
 * until BOTH have entered the write path, guaranteeing genuine overlap
 * regardless of how fast either transaction runs.
 *
 * The current (fixed) implementation replaces the SELECT/INSERT split with
 * one atomic `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` — there is
 * no separate read step to synchronize at, so forcing both transactions to
 * literally enter their INSERT statement simultaneously isolates whether the
 * primary key's own conflict serialization (not a preliminary read) is what
 * makes this correct.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { isIntegrationTestReady } from "@/test/integration-setup";

const DB_URL = process.env.SUPABASE_DB_URL;

describe.skipIf(!isIntegrationTestReady || !DB_URL)(
  "increment_rate_limit — deterministic cold-start race",
  () => {
    it(
      "two concurrent transactions forced to enter INSERT simultaneously for a brand-new key produce exactly one true, one false, and committed count 2",
      async () => {
        const setupClient = new Client({ connectionString: DB_URL });
        const clientA = new Client({ connectionString: DB_URL });
        const clientB = new Client({ connectionString: DB_URL });

        const classId = Math.floor(Math.random() * 1_000_000_000) + 1;
        const bucket = "test.cold-start-race";
        const subject = `rl-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const triggerFn = "public.__test_rl_race_barrier";
        const triggerName = "__test_rl_race_barrier";

        let barrierInstalled = false;

        try {
          await setupClient.connect();
          await clientA.connect();
          await clientB.connect();

          await clientA.query("SET statement_timeout = '10s'");
          await clientB.query("SET statement_timeout = '10s'");

          // Install the test-only barrier trigger: inert unless the calling
          // connection has set dividimos.race_barrier_class, in which case
          // it rendezvouses on an advisory lock until two distinct classid
          // locks are simultaneously granted, then lets the INSERT proceed.
          await setupClient.query(`
            CREATE OR REPLACE FUNCTION ${triggerFn}()
            RETURNS trigger
            LANGUAGE plpgsql
            SECURITY INVOKER
            SET search_path = pg_catalog
            AS $fn$
            DECLARE
              v_class_id int;
              v_deadline timestamptz;
              v_count    int;
            BEGIN
              v_class_id := nullif(current_setting('dividimos.race_barrier_class', true), '')::int;
              IF v_class_id IS NULL THEN
                RETURN NEW;
              END IF;

              -- Session-scoped (not pg_advisory_xact_lock): a transaction-
              -- scoped lock releases the instant this single-statement
              -- implicit transaction commits, which can happen before the
              -- OTHER racing connection's poll loop ever observes it —
              -- reintroducing exactly the kind of transient-visibility gap
              -- this barrier exists to eliminate. The session-scoped lock
              -- stays registered in pg_locks for the life of the
              -- connection, so both participants' locks remain reliably
              -- observable regardless of how fast either statement commits.
              PERFORM pg_advisory_lock(v_class_id, pg_backend_pid());

              v_deadline := clock_timestamp() + interval '5 seconds';
              LOOP
                SELECT count(*) INTO v_count
                  FROM pg_locks
                 WHERE locktype = 'advisory'
                   AND classid = v_class_id
                   AND granted;
                EXIT WHEN v_count >= 2;
                IF clock_timestamp() > v_deadline THEN
                  RAISE EXCEPTION 'race barrier deadline exceeded (saw % of 2 expected)', v_count;
                END IF;
                PERFORM pg_sleep(0.01);
              END LOOP;

              RETURN NEW;
            END;
            $fn$;
          `);
          await setupClient.query(
            `REVOKE ALL ON FUNCTION ${triggerFn}() FROM PUBLIC, anon, authenticated, service_role`,
          );
          await setupClient.query(`
            CREATE TRIGGER ${triggerName}
              BEFORE INSERT ON public.rate_limit_counters
              FOR EACH ROW
              EXECUTE FUNCTION ${triggerFn}();
          `);
          barrierInstalled = true;

          await clientA.query(`SET dividimos.race_barrier_class = '${classId}'`);
          await clientB.query(`SET dividimos.race_barrier_class = '${classId}'`);

          const callA = clientA.query(
            "SELECT public.increment_rate_limit($1, $2, $3, $4) AS ok",
            [bucket, subject, 1, 60],
          );
          const callB = clientB.query(
            "SELECT public.increment_rate_limit($1, $2, $3, $4) AS ok",
            [bucket, subject, 1, 60],
          );

          const [resultA, resultB] = await Promise.all([callA, callB]);

          const okA = resultA.rows[0].ok as boolean;
          const okB = resultB.rows[0].ok as boolean;

          // Reaching this line without either query throwing already proves
          // both transactions passed through the trigger's two-lock
          // rendezvous — i.e. both genuinely overlapped inside PostgreSQL at
          // the INSERT statement itself.
          const trueCount = [okA, okB].filter((v) => v === true).length;
          const falseCount = [okA, okB].filter((v) => v === false).length;
          expect(trueCount).toBe(1);
          expect(falseCount).toBe(1);

          const countRow = await setupClient.query(
            "SELECT count FROM public.rate_limit_counters WHERE bucket = $1 AND subject = $2",
            [bucket, subject],
          );
          expect(countRow.rows[0].count).toBe(2);
        } finally {
          // Close A and B first so their transaction/advisory/table-level
          // locks are fully released before teardown DDL runs.
          await clientA.end().catch(() => {});
          await clientB.end().catch(() => {});

          if (barrierInstalled) {
            await setupClient
              .query(`DROP TRIGGER IF EXISTS ${triggerName} ON public.rate_limit_counters`)
              .catch(() => {});
            await setupClient.query(`DROP FUNCTION IF EXISTS ${triggerFn}()`).catch(() => {});
          }
          await setupClient
            .query("DELETE FROM public.rate_limit_counters WHERE subject = $1", [subject])
            .catch(() => {});
          await setupClient.end().catch(() => {});
        }
      },
      15_000,
    );
  },
);
