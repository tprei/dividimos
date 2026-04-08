import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthError,
  BillError,
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

  it("stores context and cause", () => {
    const cause = new Error("original");
    const err = new AppError("INTERNAL_ERROR", "oops", {
      context: { userId: "abc" },
      cause,
    });
    expect(err.context).toEqual({ userId: "abc" });
    expect(err.cause).toBe(cause);
  });

  it("returns correct default status codes", () => {
    const cases: [ConstructorParameters<typeof AppError>[0], number][] = [
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
      ["PIX_KEY_INVALID", 400],
      ["BILL_INVALID_STATE", 400],
      ["RATE_LIMIT_EXCEEDED", 429],
      ["NOT_IMPLEMENTED", 501],
      ["INTERNAL_ERROR", 500],
      ["DB_QUERY_FAILED", 500],
    ];

    for (const [code, expected] of cases) {
      expect(new AppError(code, "msg").statusCode).toBe(expected);
    }
  });

  it("serializes to JSON without context when absent", () => {
    const err = new AppError("INTERNAL_ERROR", "boom");
    expect(err.toJSON()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "boom" },
    });
  });

  it("serializes to JSON with context when present", () => {
    const err = new AppError("INTERNAL_ERROR", "boom", {
      context: { table: "bills" },
    });
    expect(err.toJSON()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "boom", context: { table: "bills" } },
    });
  });
});

describe("subclass errors", () => {
  it("AuthError sets name and inherits status", () => {
    const err = new AuthError("AUTH_UNAUTHORIZED", "no access");
    expect(err.name).toBe("AuthError");
    expect(err.statusCode).toBe(401);
    expect(err).toBeInstanceOf(AppError);
  });

  it("BillError sets name", () => {
    const err = new BillError("BILL_NOT_FOUND", "gone");
    expect(err.name).toBe("BillError");
    expect(err.statusCode).toBe(404);
  });

  it("DatabaseError defaults to 500", () => {
    const err = new DatabaseError("DB_QUERY_FAILED", "timeout");
    expect(err.statusCode).toBe(500);
  });

  it("ValidationError defaults code to VALIDATION_ERROR", () => {
    const err = new ValidationError("bad input");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.statusCode).toBe(400);
  });

  it("ValidationError accepts explicit code", () => {
    const err = new ValidationError("missing", { code: "VALIDATION_REQUIRED_FIELD" });
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

  it("returns false for non-errors", () => {
    expect(isAppError("string")).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});

describe("hasErrorCode", () => {
  it("returns true when code matches", () => {
    const err = new AppError("BILL_NOT_FOUND", "x");
    expect(hasErrorCode(err, "BILL_NOT_FOUND")).toBe(true);
  });

  it("returns false when code differs", () => {
    const err = new AppError("BILL_NOT_FOUND", "x");
    expect(hasErrorCode(err, "USER_NOT_FOUND")).toBe(false);
  });

  it("returns false for non-AppError", () => {
    expect(hasErrorCode(new Error("x"), "INTERNAL_ERROR")).toBe(false);
  });
});

describe("toAppError", () => {
  it("returns same instance for AppError input", () => {
    const err = new AppError("INTERNAL_ERROR", "x");
    expect(toAppError(err)).toBe(err);
  });

  it("wraps plain Error with INTERNAL_ERROR code", () => {
    const err = new Error("db down");
    const result = toAppError(err);
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("db down");
    expect(result.cause).toBe(err);
  });

  it("wraps non-Error values with fallback message", () => {
    const result = toAppError("something broke");
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("An unexpected error occurred");
    expect(result.context).toEqual({ originalError: "something broke" });
  });

  it("uses custom fallback message", () => {
    const result = toAppError(42, "custom fallback");
    expect(result.message).toBe("custom fallback");
  });
});
