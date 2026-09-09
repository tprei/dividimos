import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUsers,
  expectRpcError,
  type TestUser,
} from "@/test/integration-helpers";

type VendorCharge = {
  id: string;
  status: string;
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

    const history = await rpcOk<VendorCharge[]>(ownerClient, "get_vendor_charges", {
      p_limit: 50,
    });
    expect(history.some((row) => row.id === charge.id)).toBe(false);
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
    const finalHistory = await rpcOk<VendorCharge[]>(ownerClient, "get_vendor_charges", {
      p_limit: 50,
    });
    const visible = finalHistory.find((row) => row.id === charge.id);
    if (visible) {
      expect(visible.status).toBe("received");
    }
  });
});
