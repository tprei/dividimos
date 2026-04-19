import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthError,
  UserError,
  BillError,
  DraftError,
  GroupError,
  PixError,
  DatabaseError,
  ValidationError,
  isAppError,
  hasErrorCode,
  toAppError,
} from "./errors";

describe("AppError", () => {
  it("sets code, message, and default statusCode", () => {
    const err = new AppError("AUTH_UNAUTHORIZED", "not allowed");
    expect(err.code).toBe("AUTH_UNAUTHORIZED");
    expect(err.message).toBe("not allowed");
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe("AppError");
  });

  it("allows overriding statusCode", () => {
    const err = new AppError("AUTH_UNAUTHORIZED", "custom", { statusCode: 403 });
    expect(err.statusCode).toBe(403);
  });

  it("stores optional context and cause", () => {
    const cause = new Error("root");
    const err = new AppError("INTERNAL_ERROR", "oops", {
      context: { table: "bills" },
      cause,
    });
    expect(err.context).toEqual({ table: "bills" });
    expect(err.cause).toBe(cause);
  });

  it("is an instance of Error", () => {
    expect(new AppError("INTERNAL_ERROR", "x")).toBeInstanceOf(Error);
  });

  describe("default status codes", () => {
    it.each([
      ["AUTH_UNAUTHORIZED", 401],
      ["AUTH_SESSION_EXPIRED", 401],
      ["AUTH_INVALID_TOKEN", 401],
      ["USER_NOT_FOUND", 404],
      ["BILL_NOT_FOUND", 404],
      ["DRAFT_NOT_FOUND", 404],
      ["GROUP_NOT_FOUND", 404],
      ["GROUP_MEMBER_NOT_FOUND", 404],
      ["USER_ALREADY_EXISTS", 409],
      ["GROUP_ALREADY_MEMBER", 409],
      ["VALIDATION_ERROR", 400],
      ["VALIDATION_REQUIRED_FIELD", 400],
      ["VALIDATION_INVALID_FORMAT", 400],
      ["USER_INVALID_HANDLE", 400],
      ["USER_PIX_KEY_REQUIRED", 400],
      ["PIX_KEY_INVALID", 400],
      ["BILL_INVALID_STATE", 400],
      ["RATE_LIMIT_EXCEEDED", 429],
      ["NOT_IMPLEMENTED", 501],
      ["INTERNAL_ERROR", 500],
      ["DB_QUERY_FAILED", 500],
      ["EXTERNAL_SERVICE_ERROR", 500],
    ] as const)("maps %s → %d", (code, expected) => {
      expect(new AppError(code, "x").statusCode).toBe(expected);
    });
  });

  describe("toJSON", () => {
    it("serializes code and message", () => {
      const err = new AppError("BILL_NOT_FOUND", "gone");
      expect(err.toJSON()).toEqual({
        error: { code: "BILL_NOT_FOUND", message: "gone" },
      });
    });

    it("includes context when present", () => {
      const err = new AppError("INTERNAL_ERROR", "x", { context: { id: 1 } });
      expect(err.toJSON().error.context).toEqual({ id: 1 });
    });

    it("omits context when absent", () => {
      const json = new AppError("INTERNAL_ERROR", "x").toJSON();
      expect(json.error).not.toHaveProperty("context");
    });
  });
});

describe("subclass errors", () => {
  it("AuthError has correct name", () => {
    const err = new AuthError("AUTH_UNAUTHORIZED", "no");
    expect(err.name).toBe("AuthError");
    expect(err).toBeInstanceOf(AppError);
  });

  it("UserError has correct name", () => {
    expect(new UserError("USER_NOT_FOUND", "x").name).toBe("UserError");
  });

  it("BillError has correct name", () => {
    expect(new BillError("BILL_NOT_FOUND", "x").name).toBe("BillError");
  });

  it("DraftError has correct name", () => {
    expect(new DraftError("DRAFT_NOT_FOUND", "x").name).toBe("DraftError");
  });

  it("GroupError has correct name", () => {
    expect(new GroupError("GROUP_NOT_FOUND", "x").name).toBe("GroupError");
  });

  it("PixError has correct name", () => {
    expect(new PixError("PIX_KEY_INVALID", "x").name).toBe("PixError");
  });

  it("DatabaseError has correct name", () => {
    expect(new DatabaseError("DB_QUERY_FAILED", "x").name).toBe("DatabaseError");
  });

  it("ValidationError defaults code to VALIDATION_ERROR", () => {
    const err = new ValidationError("bad input");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.name).toBe("ValidationError");
  });

  it("ValidationError accepts a specific code", () => {
    const err = new ValidationError("bad", { code: "VALIDATION_REQUIRED_FIELD" });
    expect(err.code).toBe("VALIDATION_REQUIRED_FIELD");
  });
});

describe("isAppError", () => {
  it("returns true for AppError instances", () => {
    expect(isAppError(new AppError("INTERNAL_ERROR", "x"))).toBe(true);
  });

  it("returns true for subclass instances", () => {
    expect(isAppError(new AuthError("AUTH_UNAUTHORIZED", "x"))).toBe(true);
  });

  it("returns false for plain Error", () => {
    expect(isAppError(new Error("x"))).toBe(false);
  });

  it.each([null, undefined, "string", 42, {}])("returns false for %s", (v) => {
    expect(isAppError(v)).toBe(false);
  });
});

describe("hasErrorCode", () => {
  it("returns true when code matches", () => {
    const err = new AppError("BILL_NOT_FOUND", "x");
    expect(hasErrorCode(err, "BILL_NOT_FOUND")).toBe(true);
  });

  it("returns false when code differs", () => {
    const err = new AppError("BILL_NOT_FOUND", "x");
    expect(hasErrorCode(err, "INTERNAL_ERROR")).toBe(false);
  });

  it("returns false for non-AppError", () => {
    expect(hasErrorCode(new Error("x"), "INTERNAL_ERROR")).toBe(false);
  });
});

describe("toAppError", () => {
  it("returns the same AppError if already one", () => {
    const err = new AppError("BILL_NOT_FOUND", "x");
    expect(toAppError(err)).toBe(err);
  });

  it("wraps a plain Error with INTERNAL_ERROR", () => {
    const plain = new Error("boom");
    const result = toAppError(plain);
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("boom");
    expect(result.cause).toBe(plain);
  });

  it("wraps a non-Error value with fallback message", () => {
    const result = toAppError("oops");
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("An unexpected error occurred");
    expect(result.context).toEqual({ originalError: "oops" });
  });

  it("uses custom fallback message", () => {
    const result = toAppError(null, "custom fallback");
    expect(result.message).toBe("custom fallback");
  });
});
