import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

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

describe("getAuthUser", () => {
  it("returns null when there is no authenticated user and never calls the profile RPC", async () => {
    const result = await getAuthUser();

    expect(result).toBeNull();
    expect(mock.findCalls("rpc:get_my_profile", "rpc")).toHaveLength(0);
  });

  it("returns the fully mapped profile for the authenticated user", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: validMe() });

    const result = await getAuthUser();

    expect(result).toEqual({
      id: "user-a",
      handle: "alice",
      name: "Alice Test",
      avatarUrl: "https://cdn.example.com/alice.png",
      email: "alice@example.com",
      pixKeyType: "cpf",
      pixKeyHint: "***.456.789-**",
      onboarded: true,
      notificationPreferences: { expenses: true, settlements: false },
    });
  });

  it("returns Me when nullable fields are null", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", {
      data: validMe({ avatarUrl: null, pixKeyType: null, pixKeyHint: null }),
    });

    const result = await getAuthUser();

    expect(result).toEqual({
      id: "user-a",
      handle: "alice",
      name: "Alice Test",
      avatarUrl: null,
      email: "alice@example.com",
      pixKeyType: null,
      pixKeyHint: null,
      onboarded: true,
      notificationPreferences: { expenses: true, settlements: false },
    });
  });

  it("returns null when the profile RPC errors", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", {
      data: validMe(),
      error: { code: "PGRST116", message: "rpc failed" },
    });

    const result = await getAuthUser();

    expect(result).toBeNull();
  });

  it("returns null when the RPC returns null data", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: null });

    const result = await getAuthUser();

    expect(result).toBeNull();
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
    "returns null when the RPC payload is malformed ($label)",
    async ({ row }) => {
      mock.setUser({ id: "user-a" });
      mock.onRpc("get_my_profile", { data: row });

      const result = await getAuthUser();

      expect(result).toBeNull();
    },
  );

  it("rejects a profile whose id belongs to a different account (account-isolation guarantee)", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: validMe({ id: "user-b" }) });

    const result = await getAuthUser();

    expect(result).toBeNull();
  });

  it("never reads the users table directly", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: validMe() });

    await getAuthUser();

    expect(mock.findCalls("users", "from")).toHaveLength(0);
  });
});
