import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { deleteDraftFromSupabase } from "./delete-draft";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

describe("deleteDraftFromSupabase", () => {
  it("deletes a draft bill by id with status guard", async () => {
    mock.onTable("bills", { data: null, error: null });

    const result = await deleteDraftFromSupabase("draft-1");

    expect(result).toEqual({});

    const deleteCalls = mock.findCalls("bills", "delete");
    expect(deleteCalls).toHaveLength(1);

    // Verify both .eq() filters are applied (id + status)
    const eqCalls = mock.findCalls("bills", "eq");
    expect(eqCalls).toHaveLength(2);
    expect(eqCalls[0].args).toEqual(["id", "draft-1"]);
    expect(eqCalls[1].args).toEqual(["status", "draft"]);
  });

  it("returns error when delete fails", async () => {
    mock.onTable("bills", {
      data: null,
      error: { message: "Permission denied" },
    });

    const result = await deleteDraftFromSupabase("draft-1");

    expect(result).toEqual({ error: "Permission denied" });
  });

  it("returns no error on successful deletion", async () => {
    mock.onTable("bills", { data: null, error: null });

    const result = await deleteDraftFromSupabase("bill-abc");

    expect(result.error).toBeUndefined();
  });
});
