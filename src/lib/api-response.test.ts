import { describe, it, expect } from "vitest";
import { apiErrorResponse } from "./api-response";
import { AppError, ValidationError } from "./errors";

describe("apiErrorResponse", () => {
  it("redacts the message of a wrapped server (5xx) error", async () => {
    const raw = new Error('permission denied for table "users"');
    const res = apiErrorResponse(raw, "req-1");
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("An unexpected error occurred");
    expect(body.error.message).not.toContain("users");
    expect(body.error.requestId).toBe("req-1");
  });

  it("drops context for server (5xx) errors", async () => {
    const res = apiErrorResponse(
      new AppError("DB_QUERY_FAILED", "relation pg_catalog leaked", {
        context: { table: "balances", hint: "RLS policy x" },
      }),
      "req-2",
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.message).toBe("An unexpected error occurred");
    expect(body.error.context).toBeUndefined();
  });

  it("passes through the message and context of a client (4xx) error", async () => {
    const res = apiErrorResponse(
      new ValidationError("Campo 'handle' obrigatório", {
        context: { field: "handle" },
      }),
      "req-3",
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Campo 'handle' obrigatório");
    expect(body.error.context).toEqual({ field: "handle" });
  });

  it("redacts non-Error throwables without leaking their string form", async () => {
    const res = apiErrorResponse("raw db dump: SELECT * FROM users", "req-4");
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.message).toBe("An unexpected error occurred");
    expect(body.error.context).toBeUndefined();
  });
});
