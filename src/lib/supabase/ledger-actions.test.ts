import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { markPaidInSupabase, confirmPaymentInSupabase, recordPaymentInSupabase } from "./ledger-actions";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

describe("recordPaymentInSupabase", () => {
  it("inserts a payment row and updates ledger paid amount", async () => {
    mock.onTable("payments", { error: null });
    mock.onTable("ledger", { error: null });

    const result = await recordPaymentInSupabase(
      "ledger-1",
      "user-bob",
      "user-alice",
      5000,
      5000,
      "paid_unconfirmed",
    );

    expect(result).toEqual({ error: undefined });

    const inserts = mock.findCalls("payments", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toMatchObject({
      ledger_id: "ledger-1",
      from_user_id: "user-bob",
      to_user_id: "user-alice",
      amount_cents: 5000,
    });

    const updates = mock.findCalls("ledger", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({
      paid_amount_cents: 5000,
      status: "paid_unconfirmed",
    });
    expect(updates[0].args[0]).toHaveProperty("paid_at");
  });

  it("sets partially_paid status for a partial amount", async () => {
    mock.onTable("payments", { error: null });
    mock.onTable("ledger", { error: null });

    await recordPaymentInSupabase(
      "ledger-1",
      "user-bob",
      "user-alice",
      3000,
      3000,
      "partially_paid",
    );

    const updates = mock.findCalls("ledger", "update");
    expect(updates[0].args[0]).toMatchObject({
      paid_amount_cents: 3000,
      status: "partially_paid",
    });
  });

  it("returns the payment error and skips the ledger update", async () => {
    mock.onTable("payments", { error: { message: "RLS violation" } });

    const result = await recordPaymentInSupabase(
      "ledger-1",
      "user-bob",
      "user-alice",
      5000,
      5000,
      "paid_unconfirmed",
    );

    expect(result).toEqual({ error: "RLS violation" });
    expect(mock.findCalls("ledger", "update")).toHaveLength(0);
  });

  it("returns the ledger error when the update fails", async () => {
    mock.onTable("payments", { error: null });
    mock.onTable("ledger", { error: { message: "DB error" } });

    const result = await recordPaymentInSupabase(
      "ledger-1",
      "user-bob",
      "user-alice",
      5000,
      5000,
      "paid_unconfirmed",
    );

    expect(result).toEqual({ error: "DB error" });
  });
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
