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

  it.each(["invalid", "", 42, null, undefined, true])("returns false for %s", (v) => {
    expect(isBillStatus(v)).toBe(false);
  });
});

describe("isBillType", () => {
  it.each(["single_amount", "itemized"])("returns true for '%s'", (v) => {
    expect(isBillType(v)).toBe(true);
  });

  it.each(["split", null, 0])("returns false for %s", (v) => {
    expect(isBillType(v)).toBe(false);
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

  it("returns false for invalid value", () => {
    expect(isDebtStatus("overdue")).toBe(false);
  });
});

describe("isGroupMemberStatus", () => {
  it.each(["invited", "accepted"])("returns true for '%s'", (v) => {
    expect(isGroupMemberStatus(v)).toBe(true);
  });

  it("returns false for invalid value", () => {
    expect(isGroupMemberStatus("declined")).toBe(false);
  });
});

describe("isPixKeyType", () => {
  it.each(["cpf", "email", "random"])("returns true for '%s'", (v) => {
    expect(isPixKeyType(v)).toBe(true);
  });

  it("returns false for invalid value", () => {
    expect(isPixKeyType("phone")).toBe(false);
  });
});

describe("isSplitType", () => {
  it.each(["equal", "percentage", "fixed"])("returns true for '%s'", (v) => {
    expect(isSplitType(v)).toBe(true);
  });

  it("returns false for invalid value", () => {
    expect(isSplitType("custom")).toBe(false);
  });
});

describe("assertBillStatus", () => {
  it("does not throw for valid status", () => {
    expect(() => assertBillStatus("draft")).not.toThrow();
  });

  it("throws for invalid status", () => {
    expect(() => assertBillStatus("bogus")).toThrow("Invalid BillStatus");
  });

  it("includes context in error message", () => {
    expect(() => assertBillStatus("bogus", "test-ctx")).toThrow("(context: test-ctx)");
  });
});

describe("assertBillType", () => {
  it("does not throw for valid type", () => {
    expect(() => assertBillType("itemized")).not.toThrow();
  });

  it("throws for invalid type", () => {
    expect(() => assertBillType(123)).toThrow("Invalid BillType");
  });
});

describe("assertSplitType", () => {
  it("does not throw for valid type", () => {
    expect(() => assertSplitType("equal")).not.toThrow();
  });

  it("throws for invalid type", () => {
    expect(() => assertSplitType(null)).toThrow("Invalid SplitType");
  });
});

describe("assertDebtStatus", () => {
  it("does not throw for valid status", () => {
    expect(() => assertDebtStatus("pending")).not.toThrow();
  });

  it("throws for invalid status", () => {
    expect(() => assertDebtStatus("wrong")).toThrow("Invalid DebtStatus");
  });
});

describe("coerceBillStatus", () => {
  it("returns value when valid", () => {
    expect(coerceBillStatus("active", "draft")).toBe("active");
  });

  it("returns fallback when invalid", () => {
    expect(coerceBillStatus("nope", "draft")).toBe("draft");
  });
});

describe("coerceBillType", () => {
  it("returns value when valid", () => {
    expect(coerceBillType("itemized", "single_amount")).toBe("itemized");
  });

  it("returns fallback when invalid", () => {
    expect(coerceBillType(undefined, "single_amount")).toBe("single_amount");
  });
});

describe("coerceSplitType", () => {
  it("returns value when valid", () => {
    expect(coerceSplitType("fixed", "equal")).toBe("fixed");
  });

  it("returns fallback when invalid", () => {
    expect(coerceSplitType("", "equal")).toBe("equal");
  });
});

describe("coerceDebtStatus", () => {
  it("returns value when valid", () => {
    expect(coerceDebtStatus("settled", "pending")).toBe("settled");
  });

  it("returns fallback when invalid", () => {
    expect(coerceDebtStatus(999, "pending")).toBe("pending");
  });
});
