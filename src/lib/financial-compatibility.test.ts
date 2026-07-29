import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_FINANCIAL_SCHEMA_VERSION,
  decodeFinancialCompatibilityManifest,
  evaluateFinancialCompatibility,
  fetchFinancialCompatibility,
  type FinancialCompatibilityManifest,
  type NativePlatformVersion,
} from "./financial-compatibility";

const WEB: NativePlatformVersion = { onNative: false };
const NATIVE_UNKNOWN: NativePlatformVersion = { onNative: true, versionCode: null };
function native(versionCode: number): NativePlatformVersion {
  return { onNative: true, versionCode };
}

const READY: FinancialCompatibilityManifest = {
  status: "ready",
  requiredFinancialSchemaVersion: CURRENT_FINANCIAL_SCHEMA_VERSION,
  minimumNativeVersionCode: 1,
};

describe("decodeFinancialCompatibilityManifest", () => {
  it("decodes a valid ready manifest", () => {
    const result = decodeFinancialCompatibilityManifest(READY);
    expect(result).toEqual({ ok: true, value: READY });
  });

  it("decodes a valid maintenance manifest", () => {
    const raw = { status: "maintenance", requiredFinancialSchemaVersion: 1, minimumNativeVersionCode: 1 };
    const result = decodeFinancialCompatibilityManifest(raw);
    expect(result).toEqual({ ok: true, value: raw });
  });

  it.each([null, undefined, "ready", 1, [], []])("rejects non-object root %p", (raw) => {
    expect(decodeFinancialCompatibilityManifest(raw)).toEqual({
      ok: false,
      issue: { code: "invalid_manifest", path: [] },
    });
  });

  it("rejects a missing key", () => {
    const raw = { status: "ready", requiredFinancialSchemaVersion: 1 };
    expect(decodeFinancialCompatibilityManifest(raw)).toEqual({
      ok: false,
      issue: { code: "invalid_manifest", path: [] },
    });
  });

  it("rejects an unknown extra key", () => {
    const raw = { ...READY, extra: true };
    expect(decodeFinancialCompatibilityManifest(raw)).toEqual({
      ok: false,
      issue: { code: "invalid_manifest", path: [] },
    });
  });

  it("rejects an invalid status", () => {
    const raw = { ...READY, status: "closed" };
    expect(decodeFinancialCompatibilityManifest(raw)).toEqual({
      ok: false,
      issue: { code: "invalid_manifest", path: ["status"] },
    });
  });

  it.each([0, -1, 1.5, "1", null])(
    "rejects a non-positive-integer requiredFinancialSchemaVersion %p",
    (value) => {
      const raw = { ...READY, requiredFinancialSchemaVersion: value };
      expect(decodeFinancialCompatibilityManifest(raw)).toEqual({
        ok: false,
        issue: { code: "invalid_manifest", path: ["requiredFinancialSchemaVersion"] },
      });
    },
  );

  it.each([0, -1, 1.5, "1", null])(
    "rejects a non-positive-integer minimumNativeVersionCode %p",
    (value) => {
      const raw = { ...READY, minimumNativeVersionCode: value };
      expect(decodeFinancialCompatibilityManifest(raw)).toEqual({
        ok: false,
        issue: { code: "invalid_manifest", path: ["minimumNativeVersionCode"] },
      });
    },
  );
});

describe("evaluateFinancialCompatibility", () => {
  it("is compatible when ready, current schema, and web (no native build to check)", () => {
    expect(evaluateFinancialCompatibility(READY, WEB)).toEqual({ compatible: true });
  });

  it("rejects maintenance regardless of schema/native match", () => {
    const manifest: FinancialCompatibilityManifest = { ...READY, status: "maintenance" };
    expect(evaluateFinancialCompatibility(manifest, native(99))).toEqual({
      compatible: false,
      issue: { code: "maintenance" },
    });
  });

  it("rejects a required schema version above this build's version", () => {
    const manifest: FinancialCompatibilityManifest = {
      ...READY,
      requiredFinancialSchemaVersion: CURRENT_FINANCIAL_SCHEMA_VERSION + 1,
    };
    expect(evaluateFinancialCompatibility(manifest, WEB)).toEqual({
      compatible: false,
      issue: { code: "schema_outdated", requiredFinancialSchemaVersion: CURRENT_FINANCIAL_SCHEMA_VERSION + 1 },
    });
  });

  it("ignores native version code on web", () => {
    const manifest: FinancialCompatibilityManifest = { ...READY, minimumNativeVersionCode: 99 };
    expect(evaluateFinancialCompatibility(manifest, WEB)).toEqual({ compatible: true });
  });

  it("rejects a native build below the minimum version code", () => {
    const manifest: FinancialCompatibilityManifest = { ...READY, minimumNativeVersionCode: 2 };
    expect(evaluateFinancialCompatibility(manifest, native(1))).toEqual({
      compatible: false,
      issue: { code: "native_outdated", minimumNativeVersionCode: 2 },
    });
  });

  it("accepts a native build at or above the minimum version code", () => {
    const manifest: FinancialCompatibilityManifest = { ...READY, minimumNativeVersionCode: 2 };
    expect(evaluateFinancialCompatibility(manifest, native(2))).toEqual({ compatible: true });
    expect(evaluateFinancialCompatibility(manifest, native(3))).toEqual({ compatible: true });
  });

  it("fails closed on a native build with an unverifiable version code — never treated as web", () => {
    const manifest: FinancialCompatibilityManifest = { ...READY, minimumNativeVersionCode: 1 };
    expect(evaluateFinancialCompatibility(manifest, NATIVE_UNKNOWN)).toEqual({
      compatible: false,
      issue: { code: "native_unknown" },
    });
  });

  it("checks maintenance before schema before native, in that precedence", () => {
    const manifest: FinancialCompatibilityManifest = {
      status: "maintenance",
      requiredFinancialSchemaVersion: CURRENT_FINANCIAL_SCHEMA_VERSION + 1,
      minimumNativeVersionCode: 99,
    };
    expect(evaluateFinancialCompatibility(manifest, native(1))).toEqual({
      compatible: false,
      issue: { code: "maintenance" },
    });
  });
});

describe("fetchFinancialCompatibility", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches with cache: no-store and returns the evaluated result", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify(READY), { status: 200 }),
    );
    const result = await fetchFinancialCompatibility(WEB);
    expect(result).toEqual({ compatible: true });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/runtime/financial-compatibility",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("treats a non-ok response as unreachable, never falling open", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response("", { status: 500 }));
    const result = await fetchFinancialCompatibility(WEB);
    expect(result).toEqual({ compatible: false, issue: { code: "unreachable" } });
  });

  it("treats a network failure as unreachable, never falling open", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("network down"));
    const result = await fetchFinancialCompatibility(WEB);
    expect(result).toEqual({ compatible: false, issue: { code: "unreachable" } });
  });

  it("treats a malformed manifest as unreachable, never falling open", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: "ready" }), { status: 200 }),
    );
    const result = await fetchFinancialCompatibility(WEB);
    expect(result).toEqual({ compatible: false, issue: { code: "unreachable" } });
  });
});
