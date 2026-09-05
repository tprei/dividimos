import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

// Mock the server client the same way neighbouring route tests do: a bare
// `vi.fn()` whose resolved value is re-pointed at a fresh mock client per case.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

// Shape returned by the argument-free `get_my_profile` RPC (snake_case).
type ProfileRow = {
  id: string;
  email: string | null;
  handle: string | null;
  name: string;
  avatar_url: string | null;
  onboarded: boolean;
  created_at: string;
  notification_preferences: Record<string, boolean>;
  pix_key_type: "cpf" | "email" | "phone" | "random";
  pix_key_hint: string;
};

/** A single, well-formed self-profile row for account `user-a`. */
function validRow(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "user-a",
    email: "alice@example.com",
    handle: "alice",
    name: "Alice Test",
    avatar_url: "https://cdn.example.com/alice.png",
    onboarded: true,
    created_at: "2025-01-02T03:04:05.000Z",
    notification_preferences: { expenses: true, settlements: false },
    pix_key_type: "cpf",
    pix_key_hint: "***.456.789-**",
    ...overrides,
  };
}

/** Return a copy of `obj` with `key` removed, for building malformed fixtures. */
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
    // getClaims() resolves { data: null } by default (no setUser call).

    const result = await getAuthUser();

    expect(result).toBeNull();
    expect(mock.findCalls("rpc:get_my_profile", "rpc")).toHaveLength(0);
  });

  it("returns the fully mapped profile for the authenticated user", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: [validRow()] });

    const result = await getAuthUser();

    expect(result).toEqual({
      id: "user-a",
      email: "alice@example.com",
      handle: "alice",
      name: "Alice Test",
      pixKeyType: "cpf",
      pixKeyHint: "***.456.789-**",
      avatarUrl: "https://cdn.example.com/alice.png",
      onboarded: true,
      createdAt: "2025-01-02T03:04:05.000Z",
      notificationPreferences: { expenses: true, settlements: false },
    });
  });

  it("normalizes null email, handle, and avatar_url to defaults", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", {
      data: [validRow({ email: null, handle: null, avatar_url: null })],
    });

    const result = await getAuthUser();

    expect(result).toMatchObject({
      id: "user-a",
      email: "",
      handle: "",
      avatarUrl: undefined,
    });
  });

  it("returns null when the profile RPC errors, even with otherwise well-formed data", async () => {
    mock.setUser({ id: "user-a" });
    // Matching data must NOT be used when an error is present.
    mock.onRpc("get_my_profile", {
      data: [validRow()],
      error: { code: "PGRST116", message: "rpc failed" },
    });

    const result = await getAuthUser();

    expect(result).toBeNull();
  });

  it("returns null when the RPC returns an empty array", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: [] });

    const result = await getAuthUser();

    expect(result).toBeNull();
  });

  it("returns null when the RPC returns null data", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: null });

    const result = await getAuthUser();

    expect(result).toBeNull();
  });

  it("returns null when the RPC returns more than one row", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: [validRow(), validRow()] });

    const result = await getAuthUser();

    expect(result).toBeNull();
  });

  const malformedRows: { label: string; row: Record<string, unknown> }[] = [
    { label: "invalid pix_key_type", row: { ...validRow(), pix_key_type: "telepathy" } },
    { label: "missing required name field", row: omit(validRow(), "name") },
  ];

  it.each(malformedRows)(
    "returns null when the RPC row is malformed ($label)",
    async ({ row }) => {
      mock.setUser({ id: "user-a" });
      mock.onRpc("get_my_profile", { data: [row] });

      const result = await getAuthUser();

      expect(result).toBeNull();
    },
  );

  it("rejects a profile whose id belongs to a different account (account-isolation guarantee)", async () => {
    mock.setUser({ id: "user-a" });
    // A well-formed row, but for a different account id.
    mock.onRpc("get_my_profile", { data: [validRow({ id: "user-b" })] });

    const result = await getAuthUser();

    expect(result).toBeNull();
  });

  it("never reads the users table directly", async () => {
    mock.setUser({ id: "user-a" });
    mock.onRpc("get_my_profile", { data: [validRow()] });

    await getAuthUser();

    expect(mock.findCalls("users", "from")).toHaveLength(0);
  });
});
