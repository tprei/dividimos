import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { markPaidInSupabase, confirmPaymentInSupabase } from "./ledger-actions";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createClient).mockReturnValue(mock.client as any);
});

describe("markPaidInSupabase", () => {
  it("updates ledger entry to paid_unconfirmed", async () => {
    mock.onTable("ledger", { error: null });

    const result = await markPaidInSupabase("ledger-1");

    expect(result).toEqual({ error: undefined });

    const updates = mock.findCalls("ledger", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({
      status: "paid_unconfirmed",
    });
    expect(updates[0].args[0]).toHaveProperty("paid_at");
  });

  it("returns error message on failure", async () => {
    mock.onTable("ledger", { error: { message: "Not found" } });

    const result = await markPaidInSupabase("nonexistent");

    expect(result).toEqual({ error: "Not found" });
  });
});

describe("confirmPaymentInSupabase", () => {
  it("updates ledger entry to settled", async () => {
    mock.onTable("ledger", { error: null });

    const result = await confirmPaymentInSupabase("ledger-1");

    expect(result).toEqual({ error: undefined });

    const updates = mock.findCalls("ledger", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({
      status: "settled",
    });
    expect(updates[0].args[0]).toHaveProperty("confirmed_at");
  });

  it("returns error message on failure", async () => {
    mock.onTable("ledger", { error: { message: "DB error" } });

    const result = await confirmPaymentInSupabase("ledger-1");

    expect(result).toEqual({ error: "DB error" });
  });
});
