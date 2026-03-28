import { describe, it, expect } from "vitest";
import type { Database } from "@/types/database";

type SyncArgs = Database["public"]["Functions"]["sync_group_settlements"]["Args"];
type SyncReturns = Database["public"]["Functions"]["sync_group_settlements"]["Returns"];

describe("sync_group_settlements type definitions", () => {
  it("Args type accepts required p_group_id and optional p_edges", () => {
    const argsWithEdges: SyncArgs = {
      p_group_id: "some-uuid",
      p_edges: JSON.stringify([
        { from_user_id: "a", to_user_id: "b", amount_cents: 1000 },
      ]),
    };
    expect(argsWithEdges.p_group_id).toBe("some-uuid");

    const argsWithoutEdges: SyncArgs = {
      p_group_id: "some-uuid",
    };
    expect(argsWithoutEdges.p_edges).toBeUndefined();
  });

  it("Returns type has all group_settlements columns", () => {
    const row: SyncReturns[number] = {
      id: "gs-1",
      group_id: "group-1",
      from_user_id: "user-a",
      to_user_id: "user-b",
      amount_cents: 5000,
      paid_amount_cents: 0,
      status: "pending",
      paid_at: null,
      confirmed_at: null,
      created_at: "2024-01-01T00:00:00Z",
    };

    expect(row.id).toBe("gs-1");
    expect(row.status).toBe("pending");
    expect(row.paid_amount_cents).toBe(0);
  });

  it("Returns status is constrained to valid debt_status values", () => {
    const statuses: SyncReturns[number]["status"][] = [
      "pending",
      "partially_paid",
      "settled",
    ];
    expect(statuses).toHaveLength(3);
  });
});
