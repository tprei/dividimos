import { test, expect } from "../fixtures";

test.describe("Security: an invitation can always be declined", () => {
  test("a stranger made payer on a bill next to a departed member still declines the invitation", async ({
    seed,
    newSession,
    adminClient,
  }) => {
    const mallory = await seed.createUser({ name: "Mallory Armadilha" });
    const frank = await seed.createUser({ name: "Frank Armadilha" });
    const victim = await seed.createUser({ name: "Vitima Armadilha" });

    const group = await seed.createGroup(mallory.id, [frank.id], "Armadilha de convite");
    await seed.inviteMember(mallory.id, group.id, victim.id);

    await seed.createExpense(group.id, mallory.id, [], {
      title: "Vitima pagou o Frank",
      totalCents: 100,
      participants: [
        { kind: "user", userId: mallory.id },
        { kind: "user", userId: victim.id },
        { kind: "user", userId: frank.id },
      ],
      shares: [0, 0, 100],
      payers: [{ participantIndex: 1, amountCents: 100 }],
    });
    await seed.createExpense(group.id, mallory.id, [], {
      title: "Frank pagou a Mallory",
      totalCents: 100,
      participants: [
        { kind: "user", userId: mallory.id },
        { kind: "user", userId: frank.id },
      ],
      shares: [100, 0],
      payers: [{ participantIndex: 1, amountCents: 100 }],
    });

    const frankClient = await seed.authenticateAs(frank.id);
    const { error: leaveError } = await frankClient.rpc("leave_group", { p_group_id: group.id });
    expect(leaveError).toBeNull();

    await seed.createExpense(group.id, mallory.id, [], {
      title: "Divida inventada",
      totalCents: 99_999_999,
      participants: [
        { kind: "user", userId: mallory.id },
        { kind: "user", userId: victim.id },
      ],
      shares: [0, 99_999_999],
      payers: [{ participantIndex: 0, amountCents: 99_999_999 }],
    });

    const { context, page } = await newSession(victim);
    await page.goto("/app/groups");
    await expect(page.getByText("Convite · Armadilha de convite")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Recusar convite para Armadilha de convite" }).click();
    await expect(page.getByText("Convite · Armadilha de convite")).not.toBeVisible({ timeout: 10000 });

    await expect
      .poll(async () => {
        const { data } = await adminClient
          .from("group_members")
          .select("user_id")
          .eq("group_id", group.id)
          .eq("user_id", victim.id);
        return data?.length ?? -1;
      }, { timeout: 10000 })
      .toBe(0);

    await context.close();
  });
});
