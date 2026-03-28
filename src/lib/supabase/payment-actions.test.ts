import { describe, expect, it, vi, beforeEach } from "vitest";
import { recordPayment } from "./payment-actions";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mockSupabase,
}));

let mockSupabase: {
  rpc: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockSupabase = {
    rpc: vi.fn(),
  };
});

describe("recordPayment", () => {
  it("calls create_payment RPC with correct params", async () => {
    mockSupabase.rpc.mockResolvedValue({ data: "bill-payment-1", error: null });

    const result = await recordPayment("user-a", "user-b", 5000);

    expect(mockSupabase.rpc).toHaveBeenCalledWith("create_payment", {
      p_from_user_id: "user-a",
      p_to_user_id: "user-b",
      p_amount_cents: 5000,
      p_group_id: null,
    });
    expect(result).toEqual({ billId: "bill-payment-1" });
  });

  it("passes groupId when provided", async () => {
    mockSupabase.rpc.mockResolvedValue({ data: "bill-payment-1", error: null });

    await recordPayment("user-a", "user-b", 3000, "group-1");

    expect(mockSupabase.rpc).toHaveBeenCalledWith("create_payment", {
      p_from_user_id: "user-a",
      p_to_user_id: "user-b",
      p_amount_cents: 3000,
      p_group_id: "group-1",
    });
  });

  it("returns error when RPC fails", async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: "Not authorized" } });

    const result = await recordPayment("user-a", "user-b", 5000);

    expect(result).toEqual({ error: "Not authorized" });
  });
});
