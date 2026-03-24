import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";
import { userAlice, userBob, userCarlos, makeItemizedBill } from "@/test/fixtures";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { saveDraftToSupabase } from "./save-draft";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

describe("saveDraftToSupabase", () => {
  it("creates a new draft bill and inserts participants", async () => {
    // bills.insert
    mock.onTable("bills", { data: { id: "draft-1" } });
    // bill_participants.select (existing)
    mock.onTable("bill_participants", { data: [] });
    // bill_participants.insert (new participants)
    mock.onTable("bill_participants", { error: null });

    const result = await saveDraftToSupabase({
      bill: makeItemizedBill({ title: "Rascunho" }),
      participants: [userAlice, userBob],
      creatorId: "user-alice",
    });

    expect(result).toEqual({ billId: "draft-1" });

    // Verify draft status
    const inserts = mock.findCalls("bills", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toMatchObject({
      status: "draft",
      title: "Rascunho",
    });

    // Creator should be "accepted", others "invited"
    const participantInserts = mock.findCalls("bill_participants", "insert");
    expect(participantInserts).toHaveLength(1);
    const rows = participantInserts[0].args[0] as Record<string, unknown>[];
    const aliceRow = rows.find((r) => r.user_id === "user-alice")!;
    const bobRow = rows.find((r) => r.user_id === "user-bob")!;
    expect(aliceRow.status).toBe("accepted");
    expect(bobRow.status).toBe("invited");
    expect(bobRow.invited_by).toBe("user-alice");
  });

  it("updates an existing draft and reconciles participants", async () => {
    // bills.update
    mock.onTable("bills", { error: null });
    // bill_participants.select (existing: alice + bob)
    mock.onTable("bill_participants", {
      data: [{ user_id: "user-alice" }, { user_id: "user-bob" }],
    });
    // bill_participants.delete (remove bob)
    mock.onTable("bill_participants", { error: null });
    // bill_participants.insert (add carlos)
    mock.onTable("bill_participants", { error: null });

    const result = await saveDraftToSupabase({
      bill: makeItemizedBill({ title: "Updated" }),
      participants: [userAlice, userCarlos], // bob removed, carlos added
      creatorId: "user-alice",
      existingBillId: "draft-existing",
    });

    expect(result).toEqual({ billId: "draft-existing" });

    // Verify update (not insert) on bills table
    expect(mock.findCalls("bills", "update")).toHaveLength(1);
    expect(mock.findCalls("bills", "insert")).toHaveLength(0);

    // Verify bob was removed
    const deleteCalls = mock.findCalls("bill_participants", "delete");
    expect(deleteCalls).toHaveLength(1);

    // Verify carlos was added
    const insertCalls = mock.findCalls("bill_participants", "insert");
    expect(insertCalls).toHaveLength(1);
    const insertedParticipants = insertCalls[0].args[0] as { user_id: string }[];
    expect(insertedParticipants).toHaveLength(1);
    expect(insertedParticipants[0].user_id).toBe("user-carlos");
  });

  it("auto-accepts all participants for group bills", async () => {
    mock.onTable("bills", { data: { id: "group-draft-1" } });
    mock.onTable("bill_participants", { data: [] });
    mock.onTable("bill_participants", { error: null });

    await saveDraftToSupabase({
      bill: makeItemizedBill(),
      participants: [userAlice, userBob],
      creatorId: "user-alice",
      groupId: "group-1",
    });

    const inserts = mock.findCalls("bill_participants", "insert");
    const rows = inserts[0].args[0] as Record<string, unknown>[];
    // Both participants should be auto-accepted in group context
    expect(rows.every((r) => r.status === "accepted")).toBe(true);
  });

  it("returns error when bill insert fails", async () => {
    mock.onTable("bills", {
      data: null,
      error: { message: "Insert failed" },
    });

    const result = await saveDraftToSupabase({
      bill: makeItemizedBill(),
      participants: [userAlice],
      creatorId: "user-alice",
    });

    expect(result).toEqual({ error: "Insert failed" });
  });

  it("returns error when bill update fails", async () => {
    mock.onTable("bills", { error: { message: "Update failed" } });

    const result = await saveDraftToSupabase({
      bill: makeItemizedBill(),
      participants: [userAlice],
      creatorId: "user-alice",
      existingBillId: "draft-1",
    });

    expect(result).toEqual({ error: "Update failed" });
  });

  it("does not insert or delete participants when list is unchanged", async () => {
    mock.onTable("bills", { error: null });
    mock.onTable("bill_participants", {
      data: [{ user_id: "user-alice" }, { user_id: "user-bob" }],
    });

    await saveDraftToSupabase({
      bill: makeItemizedBill(),
      participants: [userAlice, userBob],
      creatorId: "user-alice",
      existingBillId: "draft-1",
    });

    expect(mock.findCalls("bill_participants", "insert")).toHaveLength(0);
    expect(mock.findCalls("bill_participants", "delete")).toHaveLength(0);
  });
});
