import { describe, it, expect } from "vitest";
import { isDebtStatus, coerceDebtStatus } from "./type-guards";

describe("isDebtStatus", () => {
  it.each(["pending", "partially_paid", "settled"])("returns true for '%s'", (v) => {
    expect(isDebtStatus(v)).toBe(true);
  });

  it.each(["invalid", "", 42, null, undefined, true])("returns false for %s", (v) => {
    expect(isDebtStatus(v)).toBe(false);
  });
});

describe("coerceDebtStatus", () => {
  it("returns value when valid", () => {
    expect(coerceDebtStatus("settled", "pending")).toBe("settled");
  });

  it("returns fallback when invalid", () => {
    expect(coerceDebtStatus("nope", "pending")).toBe("pending");
  });
});
