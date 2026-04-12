import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { getOrCreateDmGroup } from "./dm-actions";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

describe("getOrCreateDmGroup", () => {
  it("returns error when not authenticated", async () => {
    const result = await getOrCreateDmGroup("other-user-id");

    expect(result).toEqual({
      error: "Não autenticado",
      code: "not_authenticated",
    });
  });

  it("returns groupId on successful RPC call", async () => {
    mock.setUser({ id: "user-alice" });

    mock.onRpc("get_or_create_dm_group", {
      data: "group-dm-1",
      error: null,
    });

    const result = await getOrCreateDmGroup("user-bob");

    expect(result).toEqual({ groupId: "group-dm-1" });

    const rpcCalls = mock.findCalls("rpc:get_or_create_dm_group", "rpc");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toEqual([
      "get_or_create_dm_group",
      { p_other_user_id: "user-bob" },
    ]);
  });

  it("returns typed error when RPC fails with invalid_operation", async () => {
    mock.setUser({ id: "user-alice" });

    mock.onRpc("get_or_create_dm_group", {
      error: {
        message: "invalid_operation: cannot create a DM with yourself",
      },
    });

    const result = await getOrCreateDmGroup("user-alice");

    expect(result).toEqual({
      error: "cannot create a DM with yourself",
      code: "invalid_operation",
    });
  });

  it("returns typed error when RPC fails with user_not_found", async () => {
    mock.setUser({ id: "user-alice" });

    mock.onRpc("get_or_create_dm_group", {
      error: {
        message: "user_not_found: the other user does not exist",
      },
    });

    const result = await getOrCreateDmGroup("nonexistent");

    expect(result).toEqual({
      error: "the other user does not exist",
      code: "user_not_found",
    });
  });

  it("returns unknown code for unparseable error", async () => {
    mock.setUser({ id: "user-alice" });

    mock.onRpc("get_or_create_dm_group", {
      error: { message: "something unexpected happened" },
    });

    const result = await getOrCreateDmGroup("user-bob");

    expect(result).toEqual({
      error: "something unexpected happened",
      code: "unknown",
    });
  });
});
