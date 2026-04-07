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
  it("accepts valid statuses", () => {
    for (const v of ["draft", "active", "partially_settled", "settled"]) {
      expect(isBillStatus(v)).toBe(true);
    }
  });

  it("rejects invalid strings", () => {
    expect(isBillStatus("unknown")).toBe(false);
    expect(isBillStatus("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isBillStatus(42)).toBe(false);
    expect(isBillStatus(null)).toBe(false);
    expect(isBillStatus(undefined)).toBe(false);
  });
});

describe("isBillType", () => {
  it("accepts valid types", () => {
    expect(isBillType("single_amount")).toBe(true);
    expect(isBillType("itemized")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isBillType("other")).toBe(false);
    expect(isBillType(0)).toBe(false);
  });
});

describe("isBillParticipantStatus", () => {
  it("accepts valid statuses", () => {
    for (const v of ["invited", "accepted", "declined"]) {
      expect(isBillParticipantStatus(v)).toBe(true);
    }
  });

  it("rejects invalid values", () => {
    expect(isBillParticipantStatus("pending")).toBe(false);
  });
});

describe("isDebtStatus", () => {
  it("accepts valid statuses", () => {
    for (const v of ["pending", "partially_paid", "settled"]) {
      expect(isDebtStatus(v)).toBe(true);
    }
  });

  it("rejects invalid values", () => {
    expect(isDebtStatus("overdue")).toBe(false);
  });
});

describe("isGroupMemberStatus", () => {
  it("accepts valid statuses", () => {
    expect(isGroupMemberStatus("invited")).toBe(true);
    expect(isGroupMemberStatus("accepted")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isGroupMemberStatus("declined")).toBe(false);
  });
});

describe("isPixKeyType", () => {
  it("accepts valid types", () => {
    for (const v of ["phone", "cpf", "email", "random"]) {
      expect(isPixKeyType(v)).toBe(true);
    }
  });

  it("rejects invalid values", () => {
    expect(isPixKeyType("cnpj")).toBe(false);
  });
});

describe("isSplitType", () => {
  it("accepts valid types", () => {
    for (const v of ["equal", "percentage", "fixed"]) {
      expect(isSplitType(v)).toBe(true);
    }
  });

  it("rejects invalid values", () => {
    expect(isSplitType("weighted")).toBe(false);
  });
});

describe("assertBillStatus", () => {
  it("does not throw for valid status", () => {
    expect(() => assertBillStatus("draft")).not.toThrow();
  });

  it("throws for invalid status", () => {
    expect(() => assertBillStatus("bad")).toThrow(/Invalid BillStatus/);
  });

  it("includes context in error message", () => {
    expect(() => assertBillStatus("bad", "test ctx")).toThrow("test ctx");
  });
});

describe("assertBillType", () => {
  it("does not throw for valid type", () => {
    expect(() => assertBillType("itemized")).not.toThrow();
  });

  it("throws for invalid type", () => {
    expect(() => assertBillType(123)).toThrow(/Invalid BillType/);
  });
});

describe("assertSplitType", () => {
  it("does not throw for valid type", () => {
    expect(() => assertSplitType("equal")).not.toThrow();
  });

  it("throws for invalid type", () => {
    expect(() => assertSplitType(null)).toThrow(/Invalid SplitType/);
  });
});

describe("assertDebtStatus", () => {
  it("does not throw for valid status", () => {
    expect(() => assertDebtStatus("pending")).not.toThrow();
  });

  it("throws for invalid status", () => {
    expect(() => assertDebtStatus("nope")).toThrow(/Invalid DebtStatus/);
  });
});

describe("coerceBillStatus", () => {
  it("returns the value when valid", () => {
    expect(coerceBillStatus("active", "draft")).toBe("active");
  });

  it("returns the fallback when invalid", () => {
    expect(coerceBillStatus("nope", "draft")).toBe("draft");
  });
});

describe("coerceBillType", () => {
  it("returns the value when valid", () => {
    expect(coerceBillType("itemized", "single_amount")).toBe("itemized");
  });

  it("returns the fallback when invalid", () => {
    expect(coerceBillType(99, "single_amount")).toBe("single_amount");
  });
});

describe("coerceSplitType", () => {
  it("returns the value when valid", () => {
    expect(coerceSplitType("percentage", "equal")).toBe("percentage");
  });

  it("returns the fallback when invalid", () => {
    expect(coerceSplitType(undefined, "equal")).toBe("equal");
  });
});

describe("coerceDebtStatus", () => {
  it("returns the value when valid", () => {
    expect(coerceDebtStatus("settled", "pending")).toBe("settled");
  });

  it("returns the fallback when invalid", () => {
    expect(coerceDebtStatus("", "pending")).toBe("pending");
  });
});
