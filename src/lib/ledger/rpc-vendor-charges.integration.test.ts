import { beforeAll, describe, expect, it } from "vitest";

interface ChargePageWire {
  charges: VendorCharge[];
  nextCursor: { createdAt: string; id: string } | null;
  complete: boolean;
  total: number;
  receivedCount: number;
  receivedTodayCents: number;
}
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUsers,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

type VendorCharge = {
  id: string;
  status: string;
  createdAt: string;
  amountCents: number;
};

type RpcResult<T> = { data: T | null; error: { message: string } | null };

async function rpcOk<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = (await client.rpc(fn, args)) as RpcResult<T>;
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

async function rpcErrorCode(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<string> {
  return expectRpcError(Promise.resolve(client.rpc(fn, args)));
}

describe.skipIf(!isIntegrationTestReady)("vendor charge cancellation RPCs", () => {
  let owner: TestUser;
  let other: TestUser;
  let ownerClient: SupabaseClient;
  let otherClient: SupabaseClient;

  beforeAll(async () => {
    [owner, other] = await createTestUsers(2);
    ownerClient = authenticateAs(owner);
    otherClient = authenticateAs(other);
  });

  it("cancels pending charges idempotently and hides them from history", async () => {
    const charge = await rpcOk<VendorCharge>(ownerClient, "record_vendor_charge", {
      p_amount_cents: 1200,
      p_description: "cancelar",
    });

    await rpcOk<void>(ownerClient, "cancel_vendor_charge", {
      p_charge_id: charge.id,
    });
    await rpcOk<void>(ownerClient, "cancel_vendor_charge", {
      p_charge_id: charge.id,
    });

    await expect(
      rpcErrorCode(ownerClient, "confirm_vendor_charge", { p_charge_id: charge.id }),
    ).resolves.toBe("charge_cancelled");

    const history = await rpcOk<ChargePageWire>(ownerClient, "get_vendor_charges", {
      p_limit: 50,
    });
    expect(history.charges.some((row) => row.id === charge.id)).toBe(false);
  });

  it("does not reveal or cancel another owner's pending charge", async () => {
    const charge = await rpcOk<VendorCharge>(ownerClient, "record_vendor_charge", {
      p_amount_cents: 1300,
      p_description: "ownership",
    });

    await expect(
      rpcErrorCode(otherClient, "cancel_vendor_charge", { p_charge_id: charge.id }),
    ).resolves.toBe("charge_not_found");

    await rpcOk<void>(ownerClient, "cancel_vendor_charge", {
      p_charge_id: charge.id,
    });
  });

  it("never cancels a received charge", async () => {
    const charge = await rpcOk<VendorCharge>(ownerClient, "record_vendor_charge", {
      p_amount_cents: 1400,
      p_description: "received",
    });

    const received = await rpcOk<VendorCharge>(ownerClient, "confirm_vendor_charge", {
      p_charge_id: charge.id,
    });
    expect(received.status).toBe("received");

    await expect(
      rpcErrorCode(ownerClient, "cancel_vendor_charge", { p_charge_id: charge.id }),
    ).resolves.toBe("charge_already_received");

    const confirmedAgain = await rpcOk<VendorCharge>(ownerClient, "confirm_vendor_charge", {
      p_charge_id: charge.id,
    });
    expect(confirmedAgain.status).toBe("received");
  });

  it("serializes confirm and cancel so the final status is terminal", async () => {
    const charge = await rpcOk<VendorCharge>(ownerClient, "record_vendor_charge", {
      p_amount_cents: 1500,
      p_description: "race",
    });

    const outcomes = await Promise.allSettled([
      ownerClient.rpc("cancel_vendor_charge", { p_charge_id: charge.id }),
      ownerClient.rpc("confirm_vendor_charge", { p_charge_id: charge.id }),
    ]);

    expect(outcomes).toHaveLength(2);
    const finalHistory = await rpcOk<ChargePageWire>(ownerClient, "get_vendor_charges", {
      p_limit: 50,
    });
    const visible = finalHistory.charges.find((row) => row.id === charge.id);
    if (visible) {
      expect(visible.status).toBe("received");
    }
  });

  it("pages history and reports counts over the whole scope", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const row = await rpcOk<VendorCharge>(ownerClient, "record_vendor_charge", {
        p_amount_cents: 100 + i,
        p_description: `paging ${i}`,
      });
      ids.push(row.id);
    }

    const first = await rpcOk<ChargePageWire>(ownerClient, "get_vendor_charges", {
      p_limit: 2,
    });
    expect(first.charges).toHaveLength(2);
    expect(first.complete).toBe(false);
    expect(first.nextCursor).not.toBeNull();
    // Totals describe every uncancelled charge, not this page.
    expect(first.total).toBeGreaterThanOrEqual(5);

    const seen = new Set(first.charges.map((c) => c.id));
    let cursor = first.nextCursor;
    let complete = first.complete;
    let guard = 0;
    while (!complete) {
      const next = await rpcOk<ChargePageWire>(ownerClient, "get_vendor_charges", {
        p_limit: 2,
        p_before_created_at: cursor!.createdAt,
        p_before_id: cursor!.id,
      });
      for (const row of next.charges) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = next.nextCursor;
      complete = next.complete;
      if (++guard > 20) throw new Error("cursor walk failed to terminate");
    }

    expect(seen.size).toBe(first.total);
    for (const id of ids) expect(seen.has(id)).toBe(true);
  });

  it("rejects a half-specified cursor and an out-of-range limit", async () => {
    await expect(
      rpcErrorCode(ownerClient, "get_vendor_charges", {
        p_before_created_at: new Date().toISOString(),
      }),
    ).resolves.toBe("invalid_argument");

    await expect(
      rpcErrorCode(ownerClient, "get_vendor_charges", { p_limit: 0 }),
    ).resolves.toBe("invalid_argument");
  });

  it("counts today by Sao Paulo calendar day, not creation date", async () => {
    const charge = await rpcOk<VendorCharge>(ownerClient, "record_vendor_charge", {
      p_amount_cents: 7777,
      p_description: "confirmed today",
    });
    await rpcOk(ownerClient, "confirm_vendor_charge", { p_charge_id: charge.id });

    // Created before today's local midnight but confirmed now: it counts.
    await withPg((pg) =>
      pg.query(
        "update vendor_charges set created_at = now() - interval '3 days' where id = $1",
        [charge.id],
      ),
    );

    const included = await rpcOk<ChargePageWire>(ownerClient, "get_vendor_charges", {
      p_limit: 50,
    });
    expect(included.receivedTodayCents).toBeGreaterThanOrEqual(7777);

    // Confirmed before today's local midnight: it must drop out.
    await withPg((pg) =>
      pg.query(
        "update vendor_charges set confirmed_at = (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') - interval '1 second' where id = $1",
        [charge.id],
      ),
    );

    const excluded = await rpcOk<ChargePageWire>(ownerClient, "get_vendor_charges", {
      p_limit: 50,
    });
    expect(excluded.receivedTodayCents).toBeLessThan(included.receivedTodayCents);
  });
});
