import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { getGroupNavUrl } from "./group-nav";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

describe("getGroupNavUrl", () => {
  it("returns group URL for a regular group", async () => {
    mock.onTable("groups", { data: { is_dm: false }, error: null });

    const result = await getGroupNavUrl("group-1", "user-alice");

    expect(result).toEqual({ url: "/app/groups/group-1", isDm: false });
  });

  it("routes to conversation thread for a DM group (caller is user_a)", async () => {
    mock.onTable("groups", { data: { is_dm: true }, error: null });
    mock.onTable("dm_pairs", {
      data: { user_a: "user-alice", user_b: "user-bob" },
      error: null,
    });

    const result = await getGroupNavUrl("group-dm-1", "user-alice");

    expect(result).toEqual({ url: "/app/conversations/user-bob", isDm: true });
  });

  it("routes to conversation thread for a DM group (caller is user_b)", async () => {
    mock.onTable("groups", { data: { is_dm: true }, error: null });
    mock.onTable("dm_pairs", {
      data: { user_a: "user-alice", user_b: "user-bob" },
      error: null,
    });

    const result = await getGroupNavUrl("group-dm-1", "user-bob");

    expect(result).toEqual({ url: "/app/conversations/user-alice", isDm: true });
  });

  it("falls back to group URL when dm_pairs row is missing", async () => {
    mock.onTable("groups", { data: { is_dm: true }, error: null });
    mock.onTable("dm_pairs", { data: null, error: null });

    const result = await getGroupNavUrl("group-dm-1", "user-alice");

    expect(result).toEqual({ url: "/app/groups/group-dm-1", isDm: false });
  });

  it("falls back to group URL when groups row is missing", async () => {
    mock.onTable("groups", { data: null, error: null });

    const result = await getGroupNavUrl("group-missing", "user-alice");

    expect(result).toEqual({ url: "/app/groups/group-missing", isDm: false });
  });
});
