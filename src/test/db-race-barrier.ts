/**
 * Issue #519: database-controlled proof that two concurrently-fired RPC
 * calls actually contend for the same lock inside PostgreSQL, rather than
 * trusting `Promise.allSettled` network/event-loop timing.
 *
 * A bare client-side poll of `pg_stat_activity` cannot reliably observe
 * contention against these RPCs in a local/CI database: their PL/pgSQL
 * bodies run in well under a millisecond, so the actual lock-hold window is
 * frequently shorter than one poll round-trip, and blind polling would
 * intermittently report "no contention" even when the implementation is
 * correctly atomic — exactly the nondeterministic-failure problem this
 * issue exists to eliminate.
 *
 * `forceLockContentionRace` opens an independent raw `pg` connection that
 * acquires the row lock the two racing RPC bodies are expected to contend
 * for (e.g. the `groups` or `expenses` row), fires the two RPC calls while
 * holding it, and polls `pg_stat_activity` until it observes both racing
 * backends simultaneously present with at least one of them genuinely
 * blocked (`wait_event_type = 'Lock'`) — a deterministic, database-native
 * proof of contention.
 *
 * Note on `pg_blocking_pids`: for a multi-waiter row-lock queue, PostgreSQL
 * reports FIFO wait-queue relationships, not always "blocked directly by
 * the original holder" — a second waiter is commonly reported as blocked by
 * the *first* waiter rather than by the lock holder itself. The proof below
 * therefore does not require every waiter's `pg_blocking_pids` to name the
 * holder specifically; it requires the holder to have registered a lock
 * (proving the resource is genuinely contended) and both racing backends to
 * be simultaneously present in an active/lock-waiting state, which is only
 * possible if they truly overlapped inside PostgreSQL.
 */

import { Client } from "pg";

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export type ForceLockContentionRaceOptions = Readonly<{
  /** SQL that acquires the exact lock the racing statements contend for, e.g. `select id from groups where id = $1 for update`. */
  lockSql: string;
  /** Parameters for `lockSql`. */
  lockParams: readonly unknown[];
  /** Case-insensitive substrings; a backend's `query` must contain at least one to count as a racer. */
  queryContains: readonly string[];
  /** Number of distinct racing backends expected to be observed simultaneously (usually 2). */
  expectedRacers: number;
  /** Total time budget to observe contention before giving up and releasing anyway. Default 4000ms. */
  timeoutMs?: number;
  /** Delay between polls. Default 2ms. */
  intervalMs?: number;
}>;

export type LockContentionProof = Readonly<{
  /** `true` iff `expectedRacers` distinct racing backends were observed simultaneously, with at least one genuinely lock-waiting. */
  observed: boolean;
  /** Distinct racing backend PIDs observed at proof time. */
  racerPids: readonly number[];
  /** Poll samples taken before observing full contention or timing out. */
  samples: number;
}>;

/**
 * Hold `lockSql` on an independent connection, fire `startRace` (which must
 * dispatch — but not await completion of — every racing statement) while
 * still holding the lock, poll until `expectedRacers` distinct matching
 * backends are observed simultaneously present with at least one genuinely
 * blocked, then release the lock and await the race's own result.
 */
export async function forceLockContentionRace<T>(
  databaseUrl: string,
  options: ForceLockContentionRaceOptions,
  startRace: () => Promise<T>,
): Promise<{ result: T; contention: LockContentionProof }> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const intervalMs = options.intervalMs ?? 2;
  const patterns = options.queryContains.map((s) => `%${s}%`);

  const holder = new Client(databaseUrl);
  await holder.connect();
  const monitor = new Client(databaseUrl);
  await monitor.connect();

  try {
    await holder.query("BEGIN");
    await holder.query(options.lockSql, options.lockParams as unknown[]);

    // Dispatch the race while the lock is held; every racing backend that
    // needs this resource must queue until we release below.
    const racePromise = startRace();

    const deadline = Date.now() + timeoutMs;
    let samples = 0;
    let racerPids: number[] = [];
    let sawLockWait = false;
    while (Date.now() < deadline) {
      samples += 1;
      const { rows } = await monitor.query<{
        pid: number;
        wait_event_type: string | null;
      }>(
        `SELECT pid, wait_event_type
           FROM pg_stat_activity
          WHERE pid <> pg_backend_pid()
            AND state = 'active'
            AND query ILIKE ANY ($1::text[])`,
        [patterns],
      );
      racerPids = [...new Set(rows.map((row) => row.pid))];
      sawLockWait = rows.some((row) => row.wait_event_type === "Lock");
      if (racerPids.length >= options.expectedRacers && sawLockWait) break;
      await sleep(intervalMs);
    }

    const observed = racerPids.length >= options.expectedRacers && sawLockWait;

    // Release the lock regardless of outcome so the race (and this
    // function) never hangs on a timeout; the `observed` flag alone
    // determines whether the contention proof succeeded.
    await holder.query("COMMIT");

    const result = await racePromise;
    return { result, contention: { observed, racerPids, samples } };
  } catch (error) {
    await holder.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await holder.end();
    await monitor.end();
  }
}
