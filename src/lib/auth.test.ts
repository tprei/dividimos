import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { resolveAuthProfile } from "@/lib/auth";

function validMe(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "user-a",
    handle: "alice",
    name: "Alice Test",
    avatarUrl: "https://cdn.example.com/alice.png",
    email: "alice@example.com",
    pixKeyType: "cpf",
    pixKeyHint: "***.456.789-**",
    onboarded: true,
    notificationPreferences: { expenses: true, settlements: false },
    ...overrides,
  };
}

function omit(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...obj };
  delete copy[key];
  return copy;
}

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockClear();
  vi.mocked(createClient).mockResolvedValue(mock.client);
});

describe("resolveAuthProfile", () => {
  it("reports read_failed when the server client cannot be constructed", async () => {
    vi.mocked(createClient).mockRejectedValueOnce(new Error("cookie access failed"));

    const result = await resolveAuthProfile();

    expect(result).toEqual({ kind: "read_failed" });
  });

  it("reports read_failed when getClaims throws", async () => {
    mock.setClaimsThrow(new Error("jwt decode failure"));

    const result = await resolveAuthProfile();

    expect(result).toEqual({ kind: "read_failed" });
  });

  it("reports read_failed when claims lack a string subject", async () => {
    mock.setClaimsData({ claims: { sub: null } });

    const result = await resolveAuthProfile();

    expect(result).toEqual({ kind: "read_failed" });
  });

  it("reports read_failed when the profile RPC throws", async () => {
    mock.setUser({ id: "user-a" });
    mock.setRpcThrow("get_my_profile", new Error("network failure"));

    const result = await resolveAuthProfile();

    expect(result).toEqual({ kind: "read_failed" });
  });

  it("reports unauthenticated when there are no claims and never calls the profile RPC", async () => {
    const result = await resolveAuthProfile();

    expect(result).toEqual({ kind: "unauthenticated" });
    expect(mock.findCalls("rpc:get_my_profile", "rpc")).toHaveLength(0);
  });

  it("reports unauthenticated when the SDK reports the session is explicitly missing", async () => {
    mock.setClaimsError(new AuthSessionMissingError());

    const result = await resolveAuthProfile();

    expect(result).toEqual({ kind: "unauthenticated" });
    expect(mock.findCalls("rpc:get_my_profile", "rpc")).toHaveLength(0);
  });

  it("reports read_failed for an unknown claims error so callers can retry", async () => {
    mock.setClaimsError(new Error("network outage"));

    const result = await resolveAuthProfile();

    expect(result).toEqual({ kind: "read_failed" });
    expect(mock.findCalls("rpc:get_my_profile", "rpc")).toHaveLength(0);
  });

  it("returns the fully mapped profile for the authenticated user", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: validMe() });

    const result = await resolveAuthProfile();

    expect(result).toEqual({
      kind: "ok",
      me: {
        id: "user-a",
        handle: "alice",
        name: "Alice Test",
        avatarUrl: "https://cdn.example.com/alice.png",
        email: "alice@example.com",
        pixKeyType: "cpf",
        pixKeyHint: "***.456.789-**",
        onboarded: true,
        notificationPreferences: { expenses: true, settlements: false },
      },
    });
  });

  it("returns ok when nullable fields are null", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", {
      data: validMe({ avatarUrl: null, pixKeyType: null, pixKeyHint: null }),
    });

    const result = await resolveAuthProfile();

    expect(result).toEqual({
      kind: "ok",
      me: {
        id: "user-a",
        handle: "alice",
        name: "Alice Test",
        avatarUrl: null,
        email: "alice@example.com",
        pixKeyType: null,
        pixKeyHint: null,
        onboarded: true,
        notificationPreferences: { expenses: true, settlements: false },
      },
    });
  });

  it("reports read_failed when the profile RPC errors", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", {
      data: validMe(),
      error: { code: "PGRST116", message: "rpc failed" },
    });

    const result = await resolveAuthProfile();

    expect(result).toEqual({ kind: "read_failed" });
  });

  it("reports profile_missing when the RPC succeeds with a null profile", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: null });

    const result = await resolveAuthProfile();

    expect(result).toEqual({ kind: "profile_missing" });
  });

  const malformedRows: { label: string; row: Record<string, unknown> }[] = [
    { label: "invalid pixKeyType", row: { ...validMe(), pixKeyType: "telepathy" } },
    { label: "missing required name field", row: omit(validMe(), "name") },
    {
      label: "invalid notificationPreferences category",
      row: { ...validMe(), notificationPreferences: { invalidCat: true } },
    },
    { label: "extra unrecognized key", row: { ...validMe(), extraField: "foo" } },
  ];

  it.each(malformedRows)(
    "reports read_failed when the RPC payload is malformed ($label)",
    async ({ row }) => {
      mock.setUser({ id: "user-a" });
      mock.onRpc("get_my_profile", { data: row });

      const result = await resolveAuthProfile();

      expect(result).toEqual({ kind: "read_failed" });
    },
  );

  it("reports read_failed for a profile whose id belongs to a different account (account-isolation guarantee)", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: validMe({ id: "user-b" }) });

    const result = await resolveAuthProfile();

    expect(result).toEqual({ kind: "read_failed" });
  });

  it("never reads the users table directly", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: validMe() });

    await resolveAuthProfile();

    expect(mock.findCalls("users", "from")).toHaveLength(0);
  });
});
