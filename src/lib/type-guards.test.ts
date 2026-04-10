import { describe, expect, it } from "vitest";
import {
  isBillStatus,
  isBillType,
  isBillParticipantStatus,
  isDebtStatus,
  isGroupMemberStatus,
  isPixKeyType,
  isSplitType,
  assertBillStatus,
  assertBillType,
  assertSplitType,
  assertDebtStatus,
  coerceBillStatus,
  coerceBillType,
  coerceSplitType,
  coerceDebtStatus,
} from "./type-guards";

describe("isBillStatus", () => {
  it.each(["draft", "active", "partially_settled", "settled"])("returns true for '%s'", (v) => {
    expect(isBillStatus(v)).toBe(true);
  });

  it.each(["unknown", "", 0, null, undefined, true])("returns false for %s", (v) => {
    expect(isBillStatus(v)).toBe(false);
  });
});

describe("isBillType", () => {
  it.each(["single_amount", "itemized"])("returns true for '%s'", (v) => {
    expect(isBillType(v)).toBe(true);
  });

  it("returns false for invalid value", () => {
    expect(isBillType("split")).toBe(false);
  });
});

describe("isBillParticipantStatus", () => {
  it.each(["invited", "accepted", "declined"])("returns true for '%s'", (v) => {
    expect(isBillParticipantStatus(v)).toBe(true);
  });

  it("returns false for invalid value", () => {
    expect(isBillParticipantStatus("pending")).toBe(false);
  });
});

describe("isDebtStatus", () => {
  it.each(["pending", "partially_paid", "settled"])("returns true for '%s'", (v) => {
    expect(isDebtStatus(v)).toBe(true);
  });

  it("returns false for non-string", () => {
    expect(isDebtStatus(42)).toBe(false);
  });
});

describe("isGroupMemberStatus", () => {
  it.each(["invited", "accepted"])("returns true for '%s'", (v) => {
    expect(isGroupMemberStatus(v)).toBe(true);
  });

  it("returns false for 'declined'", () => {
    expect(isGroupMemberStatus("declined")).toBe(false);
  });
});

describe("isPixKeyType", () => {
  it.each(["cpf", "email", "random"])("returns true for '%s'", (v) => {
    expect(isPixKeyType(v)).toBe(true);
  });

  it("returns false for 'phone'", () => {
    expect(isPixKeyType("phone")).toBe(false);
  });
});

describe("isSplitType", () => {
  it.each(["equal", "percentage", "fixed"])("returns true for '%s'", (v) => {
    expect(isSplitType(v)).toBe(true);
  });

  it("returns false for 'custom'", () => {
    expect(isSplitType("custom")).toBe(false);
  });
});

describe("assertBillStatus", () => {
  it("does not throw for valid status", () => {
    expect(() => assertBillStatus("draft")).not.toThrow();
  });

  it("throws for invalid status", () => {
    expect(() => assertBillStatus("nope")).toThrow(/Invalid BillStatus.*"nope"/);
  });

  it("includes context in error message", () => {
    expect(() => assertBillStatus(123, "test-ctx")).toThrow("(context: test-ctx)");
  });
});

describe("assertBillType", () => {
  it("passes for valid / throws for invalid", () => {
    expect(() => assertBillType("itemized")).not.toThrow();
    expect(() => assertBillType(null)).toThrow(/Invalid BillType/);
  });
});

describe("assertSplitType", () => {
  it("passes for valid / throws for invalid", () => {
    expect(() => assertSplitType("equal")).not.toThrow();
    expect(() => assertSplitType("weighted")).toThrow(/Invalid SplitType/);
  });
});

describe("assertDebtStatus", () => {
  it("passes for valid / throws for invalid", () => {
    expect(() => assertDebtStatus("pending")).not.toThrow();
    expect(() => assertDebtStatus(undefined)).toThrow(/Invalid DebtStatus/);
  });
});

describe("coerce helpers", () => {
  it("coerceBillStatus returns valid value or fallback", () => {
    expect(coerceBillStatus("active", "draft")).toBe("active");
    expect(coerceBillStatus("bad", "draft")).toBe("draft");
  });

  it("coerceBillType returns valid value or fallback", () => {
    expect(coerceBillType("itemized", "single_amount")).toBe("itemized");
    expect(coerceBillType(999, "single_amount")).toBe("single_amount");
  });

  it("coerceSplitType returns valid value or fallback", () => {
    expect(coerceSplitType("percentage", "equal")).toBe("percentage");
    expect(coerceSplitType(null, "equal")).toBe("equal");
  });

  it("coerceDebtStatus returns valid value or fallback", () => {
    expect(coerceDebtStatus("settled", "pending")).toBe("settled");
    expect(coerceDebtStatus("done", "pending")).toBe("pending");
  });
});
