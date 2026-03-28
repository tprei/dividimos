import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
  registerTestUser,
} from "@/test/integration-setup";
import {
  createTestUser,
  createTestUsers,
  createTestGroup,
  authenticateAs,
  type TestUser,
} from "@/test/integration-helpers";

const describeIntegration = describe.skipIf(!isIntegrationTestReady);

describeIntegration("create_payment RPC", () => {
  let payer: TestUser;
  let receiver: TestUser;
  let group: Awaited<ReturnType<typeof createTestGroup>>;

  beforeAll(async () => {
    [payer, receiver] = await createTestUsers(2);
    group = await createTestGroup(payer.id, [receiver.id]);
    // Accept the receiver's group membership
    await adminClient!
      .from("group_members")
      .update({ status: "accepted" })
      .eq("group_id", group.id)
      .eq("user_id", receiver.id);
  });

  afterAll(async () => {
    // Cascade deletes handle cleanup
  });

  it("creates a payment bill with offsetting expense_shares", async () => {
    const client = authenticateAs(payer);

    const { data: billId, error } = await client.rpc("create_payment", {
      p_from_user_id: payer.id,
      p_to_user_id: receiver.id,
      p_amount_cents: 5000,
      p_group_id: group.id,
    });

    expect(error).toBeNull();
    expect(billId).toBeTruthy();

    // Verify the payment bill
    const { data: bill } = await adminClient!
      .from("bills")
      .select("*")
      .eq("id", billId)
      .single();
    expect(bill).toBeTruthy();
    expect(bill!.bill_type).toBe("payment");
    expect(bill!.total_amount).toBe(5000);
    expect(bill!.group_id).toBe(group.id);

    // Verify offsetting shares
    const { data: shares } = await adminClient!
      .from("expense_shares")
      .select("*")
      .eq("bill_id", billId);
    expect(shares).toHaveLength(2);

    const payerShare = shares!.find((s) => s.user_id === payer.id)!;
    const receiverShare = shares!.find((s) => s.user_id === receiver.id)!;

    expect(payerShare.paid_cents).toBe(5000);
    expect(payerShare.owed_cents).toBe(0);
    expect(payerShare.net_cents).toBe(5000);

    expect(receiverShare.paid_cents).toBe(0);
    expect(receiverShare.owed_cents).toBe(5000);
    expect(receiverShare.net_cents).toBe(-5000);
  });

  it("rejects payment when caller is neither party", async () => {
    const [thirdUser] = await createTestUsers(1);
    const client = authenticateAs(thirdUser);

    const { error } = await client.rpc("create_payment", {
      p_from_user_id: payer.id,
      p_to_user_id: receiver.id,
      p_amount_cents: 1000,
      p_group_id: group.id,
    });

    expect(error).toBeTruthy();
    expect(error!.message).toContain("Not authorized");
  });

  it("rejects zero or negative amounts", async () => {
    const client = authenticateAs(payer);

    const { error } = await client.rpc("create_payment", {
      p_from_user_id: payer.id,
      p_to_user_id: receiver.id,
      p_amount_cents: 0,
      p_group_id: group.id,
    });

    expect(error).toBeTruthy();
  });

  it("works without a group_id", async () => {
    const client = authenticateAs(payer);

    const { data: billId, error } = await client.rpc("create_payment", {
      p_from_user_id: payer.id,
      p_to_user_id: receiver.id,
      p_amount_cents: 3000,
      p_group_id: null,
    });

    expect(error).toBeNull();
    expect(billId).toBeTruthy();

    const { data: bill } = await adminClient!
      .from("bills")
      .select("group_id")
      .eq("id", billId)
      .single();
    expect(bill!.group_id).toBeNull();
  });
});
