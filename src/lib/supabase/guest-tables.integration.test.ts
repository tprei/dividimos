import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestUsers,
  createTestGroup,
  createTestGroupWithMembers,
  authenticateAs,
  getBalanceBetween,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

describe.skipIf(!isIntegrationTestReady)("guest tables schema & RLS", () => {
  let alice: TestUser;
  let bob: TestUser;
  let groupId: string;
  let expenseId: string;

  beforeEach(async () => {
    [alice, bob] = await createTestUsers(2);
    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;

    // Create a draft expense
    const { data } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Guest dinner",
        total_amount: 10000,
      })
      .select("id")
      .single();

    expenseId = data!.id;
  });

  describe("expense_guests", () => {
    it("creator can insert a guest", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("expense_guests")
        .insert({
          expense_id: expenseId,
          display_name: "João",
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.display_name).toBe("João");
      expect(data!.claim_token).toBeTruthy();
      expect(data!.claimed_by).toBeNull();
      expect(data!.claimed_at).toBeNull();
    });

    it("group member can read guests", async () => {
      await adminClient!.from("expense_guests").insert({
        expense_id: expenseId,
        display_name: "Maria",
      });

      const bobClient = authenticateAs(bob);
      const { data } = await bobClient
        .from("expense_guests")
        .select("*")
        .eq("expense_id", expenseId);

      expect(data).toHaveLength(1);
      expect(data![0].display_name).toBe("Maria");
    });

    it("non-member cannot read guests", async () => {
      const [outsider] = await createTestUsers(1);

      await adminClient!.from("expense_guests").insert({
        expense_id: expenseId,
        display_name: "Hidden guest",
      });

      const outsiderClient = authenticateAs(outsider);
      const { data } = await outsiderClient
        .from("expense_guests")
        .select("*")
        .eq("expense_id", expenseId);

      expect(data).toHaveLength(0);
    });

    it("non-creator cannot insert a guest", async () => {
      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.from("expense_guests").insert({
        expense_id: expenseId,
        display_name: "Unauthorized",
      });

      expect(error).not.toBeNull();
    });

    it("cascades delete when expense is deleted", async () => {
      const { data: guest } = await adminClient!
        .from("expense_guests")
        .insert({ expense_id: expenseId, display_name: "To delete" })
        .select("id")
        .single();

      await adminClient!.from("expenses").delete().eq("id", expenseId);

      const { data } = await adminClient!
        .from("expense_guests")
        .select("*")
        .eq("id", guest!.id);

      expect(data).toHaveLength(0);
    });

    it("claim_token is unique", async () => {
      const { data: guest1 } = await adminClient!
        .from("expense_guests")
        .insert({ expense_id: expenseId, display_name: "Guest 1" })
        .select("claim_token")
        .single();

      // Try to insert with the same claim_token
      const { error } = await adminClient!.from("expense_guests").insert({
        expense_id: expenseId,
        display_name: "Guest 2",
        claim_token: guest1!.claim_token,
      });

      expect(error).not.toBeNull();
    });
  });

  describe("expense_guest_shares", () => {
    let guestId: string;

    beforeEach(async () => {
      const { data } = await adminClient!
        .from("expense_guests")
        .insert({ expense_id: expenseId, display_name: "Guest" })
        .select("id")
        .single();
      guestId = data!.id;
    });

    it("creator can insert a guest share", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("expense_guest_shares")
        .insert({
          expense_id: expenseId,
          guest_id: guestId,
          share_amount_cents: 3000,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.share_amount_cents).toBe(3000);
    });

    it("group member can read guest shares", async () => {
      await adminClient!.from("expense_guest_shares").insert({
        expense_id: expenseId,
        guest_id: guestId,
        share_amount_cents: 5000,
      });

      const bobClient = authenticateAs(bob);
      const { data } = await bobClient
        .from("expense_guest_shares")
        .select("*")
        .eq("expense_id", expenseId);

      expect(data).toHaveLength(1);
    });

    it("non-member cannot read guest shares", async () => {
      const [outsider] = await createTestUsers(1);

      await adminClient!.from("expense_guest_shares").insert({
        expense_id: expenseId,
        guest_id: guestId,
        share_amount_cents: 5000,
      });

      const outsiderClient = authenticateAs(outsider);
      const { data } = await outsiderClient
        .from("expense_guest_shares")
        .select("*")
        .eq("expense_id", expenseId);

      expect(data).toHaveLength(0);
    });

    it("rejects negative share amount", async () => {
      const { error } = await adminClient!
        .from("expense_guest_shares")
        .insert({
          expense_id: expenseId,
          guest_id: guestId,
          share_amount_cents: -100,
        });

      expect(error).not.toBeNull();
    });

    it("enforces unique (expense_id, guest_id)", async () => {
      await adminClient!.from("expense_guest_shares").insert({
        expense_id: expenseId,
        guest_id: guestId,
        share_amount_cents: 3000,
      });

      const { error } = await adminClient!
        .from("expense_guest_shares")
        .insert({
          expense_id: expenseId,
          guest_id: guestId,
          share_amount_cents: 2000,
        });

      expect(error).not.toBeNull();
    });

    it("cascades delete when guest is deleted", async () => {
      await adminClient!.from("expense_guest_shares").insert({
        expense_id: expenseId,
        guest_id: guestId,
        share_amount_cents: 3000,
      });

      await adminClient!.from("expense_guests").delete().eq("id", guestId);

      const { data } = await adminClient!
        .from("expense_guest_shares")
        .select("*")
        .eq("guest_id", guestId);

      expect(data).toHaveLength(0);
    });
  });
});

describe.skipIf(!isIntegrationTestReady)(
  "activate_expense with guest shares",
  () => {
    let alice: TestUser;
    let bob: TestUser;
    let groupId: string;

    beforeEach(async () => {
      [alice, bob] = await createTestUsers(2);
      const group = await createTestGroupWithMembers(alice, [bob]);
      groupId = group.id;
    });

    it("validates shares + guest_shares = total", async () => {
      // Create expense with total 10000
      const { data: expense } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Mixed expense",
          total_amount: 10000,
        })
        .select("id")
        .single();

      const expenseId = expense!.id;

      // Add a guest
      const { data: guest } = await adminClient!
        .from("expense_guests")
        .insert({ expense_id: expenseId, display_name: "Guest" })
        .select("id")
        .single();

      // Alice share: 5000, Bob share: 2000, Guest share: 3000 = 10000
      await Promise.all([
        adminClient!.from("expense_shares").insert([
          { expense_id: expenseId, user_id: alice.id, share_amount_cents: 5000 },
          { expense_id: expenseId, user_id: bob.id, share_amount_cents: 2000 },
        ]),
        adminClient!.from("expense_guest_shares").insert({
          expense_id: expenseId,
          guest_id: guest!.id,
          share_amount_cents: 3000,
        }),
        adminClient!.from("expense_payers").insert({
          expense_id: expenseId,
          user_id: alice.id,
          amount_cents: 10000,
        }),
      ]);

      // Activate should succeed
      const aliceClient = authenticateAs(alice);
      const { error } = await aliceClient.rpc("activate_expense", {
        p_expense_id: expenseId,
      });

      expect(error).toBeNull();

      // Verify expense is active
      const { data: updated } = await adminClient!
        .from("expenses")
        .select("status")
        .eq("id", expenseId)
        .single();

      expect(updated!.status).toBe("active");
    });

    it("rejects when shares + guest_shares != total", async () => {
      const { data: expense } = await adminClient!
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Mismatched",
          total_amount: 10000,
        })
        .select("id")
        .single();

      const expenseId = expense!.id;

      const { data: guest } = await adminClient!
        .from("expense_guests")
        .insert({ expense_id: expenseId, display_name: "Guest" })
        .select("id")
        .single();

      // Alice: 5000, Guest: 3000 = 8000 != 10000
      await Promise.all([
        adminClient!.from("expense_shares").insert({
          expense_id: expenseId,
          user_id: alice.id,
          share_amount_cents: 5000,
        }),
        adminClient!.from("expense_guest_shares").insert({
          expense_id: expenseId,
          guest_id: guest!.id,
          share_amount_cents: 3000,
        }),
        adminClient!.from("expense_payers").insert({
          expense_id: expenseId,
          user_id: alice.id,
          amount_cents: 10000,
        }),
      ]);

      const aliceClient = authenticateAs(alice);
      const { error } = await aliceClient.rpc("activate_expense", {
        p_expense_id: expenseId,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain("shares_mismatch");
    });
  },
);

describe.skipIf(!isIntegrationTestReady)("claim_guest_spot RPC", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;

  beforeEach(async () => {
    [alice, bob, carol] = await createTestUsers(3);
    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;
  });

  it("allows a user to claim an unclaimed guest spot", async () => {
    // Create expense with guest
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Claim test",
        total_amount: 10000,
      })
      .select("id")
      .single();

    const { data: guest } = await adminClient!
      .from("expense_guests")
      .insert({ expense_id: expense!.id, display_name: "Future user" })
      .select()
      .single();

    await Promise.all([
      adminClient!.from("expense_shares").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        share_amount_cents: 5000,
      }),
      adminClient!.from("expense_guest_shares").insert({
        expense_id: expense!.id,
        guest_id: guest!.id,
        share_amount_cents: 5000,
      }),
      adminClient!.from("expense_payers").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        amount_cents: 10000,
      }),
    ]);

    // Carol claims the guest spot
    const carolClient = authenticateAs(carol);
    const { data, error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: guest!.claim_token,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      guest_id: guest!.id,
      expense_id: expense!.id,
      already_claimed: false,
    });

    // Verify guest is marked as claimed
    const { data: claimedGuest } = await adminClient!
      .from("expense_guests")
      .select("claimed_by, claimed_at")
      .eq("id", guest!.id)
      .single();

    expect(claimedGuest!.claimed_by).toBe(carol.id);
    expect(claimedGuest!.claimed_at).not.toBeNull();

    // Verify expense_share was created
    const { data: share } = await adminClient!
      .from("expense_shares")
      .select("*")
      .eq("expense_id", expense!.id)
      .eq("user_id", carol.id)
      .single();

    expect(share).not.toBeNull();
    expect(share!.share_amount_cents).toBe(5000);
  });

  it("adds claiming user to the group", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Group join test",
        total_amount: 5000,
      })
      .select("id")
      .single();

    const { data: guest } = await adminClient!
      .from("expense_guests")
      .insert({ expense_id: expense!.id, display_name: "New member" })
      .select()
      .single();

    await Promise.all([
      adminClient!.from("expense_shares").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        share_amount_cents: 2500,
      }),
      adminClient!.from("expense_guest_shares").insert({
        expense_id: expense!.id,
        guest_id: guest!.id,
        share_amount_cents: 2500,
      }),
      adminClient!.from("expense_payers").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        amount_cents: 5000,
      }),
    ]);

    // Carol is not in the group yet
    const { data: membersBefore } = await adminClient!
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("user_id", carol.id);

    expect(membersBefore).toHaveLength(0);

    // Carol claims
    const carolClient = authenticateAs(carol);
    await carolClient.rpc("claim_guest_spot", {
      p_claim_token: guest!.claim_token,
    });

    // Carol should be a group member now
    const { data: membersAfter } = await adminClient!
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", carol.id)
      .single();

    expect(membersAfter).not.toBeNull();
    expect(membersAfter!.status).toBe("accepted");
  });

  it("updates balances when claiming on an active expense", async () => {
    // Create and activate expense with a guest share
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Active claim test",
        total_amount: 10000,
      })
      .select("id")
      .single();

    const { data: guest } = await adminClient!
      .from("expense_guests")
      .insert({ expense_id: expense!.id, display_name: "Late joiner" })
      .select()
      .single();

    await Promise.all([
      adminClient!.from("expense_shares").insert({
        expense_id: expense!.id,
        user_id: bob.id,
        share_amount_cents: 5000,
      }),
      adminClient!.from("expense_guest_shares").insert({
        expense_id: expense!.id,
        guest_id: guest!.id,
        share_amount_cents: 5000,
      }),
      adminClient!.from("expense_payers").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        amount_cents: 10000,
      }),
    ]);

    // Activate expense
    const aliceClient = authenticateAs(alice);
    await aliceClient.rpc("activate_expense", {
      p_expense_id: expense!.id,
    });

    // Carol claims the guest spot on the active expense
    const carolClient = authenticateAs(carol);
    await carolClient.rpc("claim_guest_spot", {
      p_claim_token: guest!.claim_token,
    });

    // Carol should now owe Alice 5000 (guest_share=5000, alice paid 10000,
    // delta = ROUND(5000 * 10000 / 10000) = 5000)
    const [userA, userB] =
      carol.id < alice.id ? [carol.id, alice.id] : [alice.id, carol.id];

    const { data: balance } = await adminClient!
      .from("balances")
      .select("amount_cents")
      .eq("group_id", groupId)
      .eq("user_a", userA)
      .eq("user_b", userB)
      .single();

    expect(balance).not.toBeNull();
    // Carol owes Alice 5000.
    // If carol < alice: positive = carol owes alice → 5000
    // If alice < carol: positive = alice owes carol → need -5000
    const expectedAmount = carol.id < alice.id ? 5000 : -5000;
    expect(balance!.amount_cents).toBe(expectedAmount);
  });

  it("is idempotent for the same user claiming twice", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Idempotent test",
        total_amount: 5000,
      })
      .select("id")
      .single();

    const { data: guest } = await adminClient!
      .from("expense_guests")
      .insert({ expense_id: expense!.id, display_name: "Guest" })
      .select()
      .single();

    await Promise.all([
      adminClient!.from("expense_shares").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        share_amount_cents: 2500,
      }),
      adminClient!.from("expense_guest_shares").insert({
        expense_id: expense!.id,
        guest_id: guest!.id,
        share_amount_cents: 2500,
      }),
      adminClient!.from("expense_payers").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        amount_cents: 5000,
      }),
    ]);

    const carolClient = authenticateAs(carol);

    // First claim
    await carolClient.rpc("claim_guest_spot", {
      p_claim_token: guest!.claim_token,
    });

    // Second claim — should return already_claimed: true, not error
    const { data, error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: guest!.claim_token,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ already_claimed: true });
  });

  it("rejects claim if token is already claimed by another user", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Double claim test",
        total_amount: 5000,
      })
      .select("id")
      .single();

    const { data: guest } = await adminClient!
      .from("expense_guests")
      .insert({ expense_id: expense!.id, display_name: "Guest" })
      .select()
      .single();

    await Promise.all([
      adminClient!.from("expense_shares").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        share_amount_cents: 2500,
      }),
      adminClient!.from("expense_guest_shares").insert({
        expense_id: expense!.id,
        guest_id: guest!.id,
        share_amount_cents: 2500,
      }),
      adminClient!.from("expense_payers").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        amount_cents: 5000,
      }),
    ]);

    // Carol claims first
    const carolClient = authenticateAs(carol);
    await carolClient.rpc("claim_guest_spot", {
      p_claim_token: guest!.claim_token,
    });

    // Bob tries to claim the same token
    const bobClient = authenticateAs(bob);
    const { error } = await bobClient.rpc("claim_guest_spot", {
      p_claim_token: guest!.claim_token,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("already_claimed");
  });

  it("rejects claim with invalid token", async () => {
    const carolClient = authenticateAs(carol);
    const { error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: "00000000-0000-0000-0000-000000000000",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("invalid_token");
  });

  it("rejects claim if user already has a share on the expense", async () => {
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Duplicate participant test",
        total_amount: 10000,
      })
      .select("id")
      .single();

    const { data: guest } = await adminClient!
      .from("expense_guests")
      .insert({ expense_id: expense!.id, display_name: "Guest" })
      .select()
      .single();

    // Bob already has a share
    await Promise.all([
      adminClient!.from("expense_shares").insert([
        {
          expense_id: expense!.id,
          user_id: alice.id,
          share_amount_cents: 4000,
        },
        { expense_id: expense!.id, user_id: bob.id, share_amount_cents: 3000 },
      ]),
      adminClient!.from("expense_guest_shares").insert({
        expense_id: expense!.id,
        guest_id: guest!.id,
        share_amount_cents: 3000,
      }),
      adminClient!.from("expense_payers").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        amount_cents: 10000,
      }),
    ]);

    // Bob tries to claim the guest spot — but he already has a share
    const bobClient = authenticateAs(bob);
    const { error } = await bobClient.rpc("claim_guest_spot", {
      p_claim_token: guest!.claim_token,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("duplicate_participant");
  });

  it("upgrades invited member to accepted when claiming guest spot", async () => {
    // Carol is invited to the group via handle (status = 'invited')
    await adminClient!.from("group_members").insert({
      group_id: groupId,
      user_id: carol.id,
      status: "invited",
      invited_by: alice.id,
    });

    // Verify Carol is invited, not accepted
    const { data: before } = await adminClient!
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", carol.id)
      .single();

    expect(before!.status).toBe("invited");

    // Create expense with a guest spot
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Invite upgrade test",
        total_amount: 10000,
      })
      .select("id")
      .single();

    const { data: guest } = await adminClient!
      .from("expense_guests")
      .insert({ expense_id: expense!.id, display_name: "Carol's spot" })
      .select()
      .single();

    await Promise.all([
      adminClient!.from("expense_shares").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        share_amount_cents: 5000,
      }),
      adminClient!.from("expense_guest_shares").insert({
        expense_id: expense!.id,
        guest_id: guest!.id,
        share_amount_cents: 5000,
      }),
      adminClient!.from("expense_payers").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        amount_cents: 10000,
      }),
    ]);

    // Activate the expense first
    const aliceClient = authenticateAs(alice);
    await aliceClient.rpc("activate_expense", { p_expense_id: expense!.id });

    // Carol claims the guest spot while still 'invited'
    const carolClient = authenticateAs(carol);
    const { error } = await carolClient.rpc("claim_guest_spot", {
      p_claim_token: guest!.claim_token,
    });

    expect(error).toBeNull();

    // Carol's status should now be 'accepted'
    const { data: after } = await adminClient!
      .from("group_members")
      .select("status, accepted_at")
      .eq("group_id", groupId)
      .eq("user_id", carol.id)
      .single();

    expect(after!.status).toBe("accepted");
    expect(after!.accepted_at).not.toBeNull();
  });

  it("invited member can see balances after claiming guest spot", async () => {
    // Carol is invited via handle
    await adminClient!.from("group_members").insert({
      group_id: groupId,
      user_id: carol.id,
      status: "invited",
      invited_by: alice.id,
    });

    // Create and activate expense with guest spot for Carol
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "Balance visibility test",
        total_amount: 10000,
      })
      .select("id")
      .single();

    const { data: guest } = await adminClient!
      .from("expense_guests")
      .insert({ expense_id: expense!.id, display_name: "Carol" })
      .select()
      .single();

    await Promise.all([
      adminClient!.from("expense_shares").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        share_amount_cents: 5000,
      }),
      adminClient!.from("expense_guest_shares").insert({
        expense_id: expense!.id,
        guest_id: guest!.id,
        share_amount_cents: 5000,
      }),
      adminClient!.from("expense_payers").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        amount_cents: 10000,
      }),
    ]);

    const aliceClient = authenticateAs(alice);
    await aliceClient.rpc("activate_expense", { p_expense_id: expense!.id });

    // Carol claims the guest spot
    const carolClient = authenticateAs(carol);
    await carolClient.rpc("claim_guest_spot", {
      p_claim_token: guest!.claim_token,
    });

    // Carol should be able to read balances (upgraded to accepted)
    const { data: balances, error } = await carolClient
      .from("balances")
      .select("*")
      .eq("group_id", groupId);

    expect(error).toBeNull();
    expect(balances!.length).toBeGreaterThan(0);

    // Verify the balance amount is correct
    const balance = await getBalanceBetween(groupId, carol.id, alice.id);
    // Carol owes Alice 5000 (positive = carol owes alice)
    expect(balance).toBe(5000);
  });

  it("does not downgrade already-accepted member when claiming guest spot", async () => {
    // Bob is already an accepted member (from beforeEach)
    // Create expense where Bob has no share but there's a guest spot
    const { data: expense } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: alice.id,
        title: "No downgrade test",
        total_amount: 5000,
      })
      .select("id")
      .single();

    const { data: guest } = await adminClient!
      .from("expense_guests")
      .insert({ expense_id: expense!.id, display_name: "Bob's extra spot" })
      .select()
      .single();

    await Promise.all([
      adminClient!.from("expense_shares").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        share_amount_cents: 2500,
      }),
      adminClient!.from("expense_guest_shares").insert({
        expense_id: expense!.id,
        guest_id: guest!.id,
        share_amount_cents: 2500,
      }),
      adminClient!.from("expense_payers").insert({
        expense_id: expense!.id,
        user_id: alice.id,
        amount_cents: 5000,
      }),
    ]);

    // Bob claims the guest spot (already accepted in the group)
    // This should fail because Bob already has... wait, Bob doesn't have a share
    // Actually Bob IS accepted and has no share on this expense, so claim should work
    const bobClient = authenticateAs(bob);
    const { error } = await bobClient.rpc("claim_guest_spot", {
      p_claim_token: guest!.claim_token,
    });

    expect(error).toBeNull();

    // Verify Bob is still accepted (not downgraded)
    const { data: membership } = await adminClient!
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", bob.id)
      .single();

    expect(membership!.status).toBe("accepted");
  });
});
