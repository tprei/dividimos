import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const ENV_KEYS = [
  "FINANCIAL_MAINTENANCE",
  "FINANCIAL_REQUIRED_SCHEMA_VERSION",
  "FINANCIAL_MINIMUM_NATIVE_VERSION_CODE",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("GET /api/runtime/financial-compatibility", () => {
  it("defaults to ready, schema version 1, native version code 1", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "ready",
      requiredFinancialSchemaVersion: 1,
      minimumNativeVersionCode: 1,
    });
  });

  it("always emits Cache-Control: no-store, max-age=0", async () => {
    const response = await GET();
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
  });

  it("reports maintenance only when FINANCIAL_MAINTENANCE is exactly 'true'", async () => {
    process.env.FINANCIAL_MAINTENANCE = "true";
    const maintenance = await GET();
    expect((await maintenance.json()).status).toBe("maintenance");

    process.env.FINANCIAL_MAINTENANCE = "TRUE";
    const notMaintenance = await GET();
    expect((await notMaintenance.json()).status).toBe("ready");

    process.env.FINANCIAL_MAINTENANCE = "1";
    const alsoNotMaintenance = await GET();
    expect((await alsoNotMaintenance.json()).status).toBe("ready");
  });

  it("reflects a configured required schema version and native version code", async () => {
    process.env.FINANCIAL_REQUIRED_SCHEMA_VERSION = "2";
    process.env.FINANCIAL_MINIMUM_NATIVE_VERSION_CODE = "2";
    const response = await GET();
    const body = await response.json();
    expect(body.requiredFinancialSchemaVersion).toBe(2);
    expect(body.minimumNativeVersionCode).toBe(2);
  });

  it("falls back to defaults for non-positive-integer overrides", async () => {
    process.env.FINANCIAL_REQUIRED_SCHEMA_VERSION = "0";
    process.env.FINANCIAL_MINIMUM_NATIVE_VERSION_CODE = "not-a-number";
    const response = await GET();
    const body = await response.json();
    expect(body.requiredFinancialSchemaVersion).toBe(1);
    expect(body.minimumNativeVersionCode).toBe(1);
  });

  it("exposes no financial or user data", async () => {
    const response = await GET();
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual([
      "minimumNativeVersionCode",
      "requiredFinancialSchemaVersion",
      "status",
    ]);
  });
});
