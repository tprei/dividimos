import type fc from "fast-check";

const DEFAULT_SEED = 20260911;

function positiveInteger(raw: string | undefined, name: string): number | null {
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Shared fast-check configuration. Pull requests run a fixed seed at a low run
 * count so a failure is always reproducible; the nightly soak raises the floor
 * through PROPERTY_RUNS and picks a fresh PROPERTY_SEED.
 *
 * PROPERTY_RUNS raises the run count and never lowers it, so a soak cannot
 * accidentally explore less than an ordinary run of a property whose own
 * default is already higher.
 */
export function propertyConfig<Ts>(defaultRuns: number): fc.Parameters<Ts> {
  const runs = positiveInteger(process.env.PROPERTY_RUNS, "PROPERTY_RUNS");
  const seed = positiveInteger(process.env.PROPERTY_SEED, "PROPERTY_SEED");
  return {
    numRuns: runs === null ? defaultRuns : Math.max(defaultRuns, runs),
    seed: seed ?? DEFAULT_SEED,
  };
}
