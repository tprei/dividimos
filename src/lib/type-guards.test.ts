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

  it.each([null, undefined, 42, "", "invalid", "Draft"])("returns false for %j", (v) => {
    expect(isBillStatus(v)).toBe(false);
  });
});

describe("isBillType", () => {
  it.each(["single_amount", "itemized"])("returns true for '%s'", (v) => {
    expect(isBillType(v)).toBe(true);
  });

  it("returns false for invalid values", () => {
    expect(isBillType("other")).toBe(false);
    expect(isBillType(0)).toBe(false);
  });
});

describe("isBillParticipantStatus", () => {
  it.each(["invited", "accepted", "declined"])("returns true for '%s'", (v) => {
    expect(isBillParticipantStatus(v)).toBe(true);
  });

  it("returns false for invalid values", () => {
    expect(isBillParticipantStatus("pending")).toBe(false);
  });
});

describe("isDebtStatus", () => {
  it.each(["pending", "partially_paid", "settled"])("returns true for '%s'", (v) => {
    expect(isDebtStatus(v)).toBe(true);
  });

  it("returns false for invalid values", () => {
    expect(isDebtStatus("unknown")).toBe(false);
  });
});

describe("isGroupMemberStatus", () => {
  it.each(["invited", "accepted"])("returns true for '%s'", (v) => {
    expect(isGroupMemberStatus(v)).toBe(true);
  });

  it("returns false for invalid values", () => {
    expect(isGroupMemberStatus("declined")).toBe(false);
  });
});

describe("isPixKeyType", () => {
  it.each(["phone", "cpf", "email", "random"])("returns true for '%s'", (v) => {
    expect(isPixKeyType(v)).toBe(true);
  });

  it("returns false for invalid values", () => {
    expect(isPixKeyType("cnpj")).toBe(false);
  });
});

describe("isSplitType", () => {
  it.each(["equal", "percentage", "fixed"])("returns true for '%s'", (v) => {
    expect(isSplitType(v)).toBe(true);
  });

  it("returns false for invalid values", () => {
    expect(isSplitType("custom")).toBe(false);
  });
});

describe("assertBillStatus", () => {
  it("does not throw for valid values", () => {
    expect(() => assertBillStatus("draft")).not.toThrow();
  });

  it("throws for invalid values", () => {
    expect(() => assertBillStatus("nope")).toThrow("Invalid BillStatus");
  });

  it("includes context in error message", () => {
    expect(() => assertBillStatus("bad", "test ctx")).toThrow("(context: test ctx)");
  });
});

describe("assertBillType", () => {
  it("does not throw for valid values", () => {
    expect(() => assertBillType("itemized")).not.toThrow();
  });

  it("throws for invalid values", () => {
    expect(() => assertBillType(null)).toThrow("Invalid BillType");
  });
});

describe("assertSplitType", () => {
  it("does not throw for valid values", () => {
    expect(() => assertSplitType("equal")).not.toThrow();
  });

  it("throws for invalid values", () => {
    expect(() => assertSplitType(123)).toThrow("Invalid SplitType");
  });
});

describe("assertDebtStatus", () => {
  it("does not throw for valid values", () => {
    expect(() => assertDebtStatus("pending")).not.toThrow();
  });

  it("throws for invalid values", () => {
    expect(() => assertDebtStatus("foo")).toThrow("Invalid DebtStatus");
  });
});

describe("coerceBillStatus", () => {
  it("returns the value when valid", () => {
    expect(coerceBillStatus("active", "draft")).toBe("active");
  });

  it("returns the fallback when invalid", () => {
    expect(coerceBillStatus("bad", "draft")).toBe("draft");
  });
});

describe("coerceBillType", () => {
  it("returns the value when valid", () => {
    expect(coerceBillType("itemized", "single_amount")).toBe("itemized");
  });

  it("returns the fallback when invalid", () => {
    expect(coerceBillType(undefined, "single_amount")).toBe("single_amount");
  });
});

describe("coerceSplitType", () => {
  it("returns the value when valid", () => {
    expect(coerceSplitType("percentage", "equal")).toBe("percentage");
  });

  it("returns the fallback when invalid", () => {
    expect(coerceSplitType("", "equal")).toBe("equal");
  });
});

describe("coerceDebtStatus", () => {
  it("returns the value when valid", () => {
    expect(coerceDebtStatus("settled", "pending")).toBe("settled");
  });

  it("returns the fallback when invalid", () => {
    expect(coerceDebtStatus(null, "pending")).toBe("pending");
  });
});
