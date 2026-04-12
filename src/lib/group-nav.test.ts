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

    const url = await getGroupNavUrl("group-1", "user-alice");

    expect(url).toBe("/app/groups/group-1");
  });

  it("routes to conversation thread for a DM group (caller is user_a)", async () => {
    mock.onTable("groups", { data: { is_dm: true }, error: null });
    mock.onTable("dm_pairs", {
      data: { user_a: "user-alice", user_b: "user-bob" },
      error: null,
    });

    const url = await getGroupNavUrl("group-dm-1", "user-alice");

    expect(url).toBe("/app/conversations/user-bob");
  });

  it("routes to conversation thread for a DM group (caller is user_b)", async () => {
    mock.onTable("groups", { data: { is_dm: true }, error: null });
    mock.onTable("dm_pairs", {
      data: { user_a: "user-alice", user_b: "user-bob" },
      error: null,
    });

    const url = await getGroupNavUrl("group-dm-1", "user-bob");

    expect(url).toBe("/app/conversations/user-alice");
  });

  it("falls back to group URL when dm_pairs row is missing", async () => {
    mock.onTable("groups", { data: { is_dm: true }, error: null });
    mock.onTable("dm_pairs", { data: null, error: null });

    const url = await getGroupNavUrl("group-dm-1", "user-alice");

    expect(url).toBe("/app/groups/group-dm-1");
  });

  it("falls back to group URL when groups row is missing", async () => {
    mock.onTable("groups", { data: null, error: null });

    const url = await getGroupNavUrl("group-missing", "user-alice");

    expect(url).toBe("/app/groups/group-missing");
  });
});
