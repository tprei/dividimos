import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";
import { AppError } from "@/lib/errors";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const mockEnforceRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
}));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupFailureResponse, lookupProfile } from "./profile-lookup";

let server: MockSupabase;
let admin: MockSupabase;

beforeEach(() => {
  server = createMockSupabase();
  admin = createMockSupabase();
  vi.mocked(createClient).mockResolvedValue(server.client);
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
  mockEnforceRateLimit.mockReset();
  mockEnforceRateLimit.mockResolvedValue(undefined);
});

describe("lookupProfile", () => {
  it("throws a 401 AppError when the session is missing", async () => {
    await expect(lookupProfile("alice")).rejects.toMatchObject({
      code: "AUTH_UNAUTHORIZED",
      statusCode: 401,
    });
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(admin.findCalls("rpc:lookup_user_by_handle", "rpc")).toHaveLength(0);
  });

  it("throws a 401 AppError when claims fail to verify", async () => {
    server.setUser({ id: "user-alice" });
    server.setClaimsError(new Error("bad signature"));

    await expect(lookupProfile("alice")).rejects.toMatchObject({
      code: "AUTH_UNAUTHORIZED",
    });
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("throws a 400 AppError for an empty handle without spending the bucket", async () => {
    server.setUser({ id: "user-alice" });

    await expect(lookupProfile("   ")).rejects.toMatchObject({
      code: "USER_INVALID_HANDLE",
      statusCode: 400,
    });
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("spends the users.lookup bucket for the authenticated caller", async () => {
    server.setUser({ id: "user-alice" });
    admin.onRpc("lookup_user_by_handle", { data: null });

    await lookupProfile("bob");

    expect(mockEnforceRateLimit).toHaveBeenCalledExactlyOnceWith("users.lookup", "user-alice");
  });

  it("normalizes the handle before the admin RPC", async () => {
    server.setUser({ id: "user-alice" });
    admin.onRpc("lookup_user_by_handle", { data: null });

    await lookupProfile("  BOB  ");

    const calls = admin.findCalls("rpc:lookup_user_by_handle", "rpc");
    expect(calls).toHaveLength(1);
    expect(calls[0].args[1]).toEqual({ p_handle: "bob" });
  });

  it("rethrows a saturated bucket without touching the backing RPC", async () => {
    server.setUser({ id: "user-alice" });
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_EXCEEDED", "Muitas requisições. Tente novamente em alguns segundos."),
    );

    await expect(lookupProfile("bob")).rejects.toMatchObject({
      code: "RATE_LIMIT_EXCEEDED",
      statusCode: 429,
    });
    expect(admin.findCalls("rpc:lookup_user_by_handle", "rpc")).toHaveLength(0);
  });

  it("fails closed with 503 when the limiter is unavailable", async () => {
    server.setUser({ id: "user-alice" });
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_UNAVAILABLE", "limiter down"),
    );

    await expect(lookupProfile("bob")).rejects.toMatchObject({
      code: "RATE_LIMIT_UNAVAILABLE",
      statusCode: 503,
    });
    expect(admin.findCalls("rpc:lookup_user_by_handle", "rpc")).toHaveLength(0);
  });

  it("fails closed with 503 when any limiter failure is unexpected", async () => {
    server.setUser({ id: "user-alice" });
    mockEnforceRateLimit.mockRejectedValue(new Error("socket hang up"));

    await expect(lookupProfile("bob")).rejects.toMatchObject({
      code: "RATE_LIMIT_UNAVAILABLE",
      statusCode: 503,
    });
    expect(admin.findCalls("rpc:lookup_user_by_handle", "rpc")).toHaveLength(0);
  });

  it("returns null when no onboarded profile owns the handle", async () => {
    server.setUser({ id: "user-alice" });
    admin.onRpc("lookup_user_by_handle", { data: null });

    await expect(lookupProfile("nobody")).resolves.toBeNull();
  });

  it("returns the decoded profile through the service-role client", async () => {
    server.setUser({ id: "user-alice" });
    admin.onRpc("lookup_user_by_handle", {
      data: { id: "user-bob", handle: "bob", name: "Bob Santos", avatarUrl: null, isBot: false },
    });

    await expect(lookupProfile("bob")).resolves.toEqual({
      id: "user-bob",
      handle: "bob",
      name: "Bob Santos",
      avatarUrl: null,
      isBot: false,
    });
  });

  it("fails closed with 5xx when the backing RPC errors", async () => {
    server.setUser({ id: "user-alice" });
    admin.onRpc("lookup_user_by_handle", { error: { message: "permission denied" } });

    await expect(lookupProfile("bob")).rejects.toMatchObject({
      code: "EXTERNAL_SERVICE_ERROR",
      statusCode: 503,
    });
  });

  it("fails closed with 5xx when the RPC payload does not decode", async () => {
    server.setUser({ id: "user-alice" });
    admin.onRpc("lookup_user_by_handle", { data: { id: "user-bob", handle: 42 } });

    await expect(lookupProfile("bob")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      statusCode: 500,
    });
  });
});

describe("lookupFailureResponse", () => {
  it("publishes the exact route contract for every typed failure", () => {
    const cases: Array<[AppError, number, string]> = [
      [new AppError("AUTH_UNAUTHORIZED", "Não autenticado"), 401, "Não autenticado"],
      [new AppError("USER_INVALID_HANDLE", "Handle obrigatorio"), 400, "Handle obrigatorio"],
      [
        new AppError("RATE_LIMIT_EXCEEDED", "Muitas requisições. Tente novamente em alguns segundos."),
        429,
        "Muitas requisições. Tente novamente em alguns segundos.",
      ],
      [new AppError("RATE_LIMIT_UNAVAILABLE", "down"), 503, "Serviço temporariamente indisponível"],
      [new AppError("EXTERNAL_SERVICE_ERROR", "down"), 503, "Serviço temporariamente indisponível"],
      [new AppError("INTERNAL_ERROR", "bad payload"), 503, "Serviço temporariamente indisponível"],
    ];
    for (const [error, status, message] of cases) {
      expect(lookupFailureResponse(error)).toEqual({ status, body: { error: message } });
    }
  });

  it("reports foreign errors as outside the lookup contract", () => {
    expect(lookupFailureResponse(new Error("boom"))).toBeNull();
    expect(lookupFailureResponse(undefined)).toBeNull();
  });
});
