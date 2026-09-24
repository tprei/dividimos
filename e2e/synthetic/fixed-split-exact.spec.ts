import { test, expect } from "../fixtures";

test.describe("Fixed-amount exact inputs", () => {
  test("three participants drive exact fixed inputs and activate", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Fixed" });
    const bob = await seed.createUser({ name: "Bob Fixed" });
    const carol = await seed.createUser({ name: "Carol Fixed" });

    const group = await seed.createGroup(
      alice.id,
      [bob.id, carol.id],
      "Fixed Split Group",
    );

    await loginAs(alice, { navigate: false });
    await page.goto(
      `/app/bill/new?groupId=${group.id}&title=Synthetic%20Dinner&amount=15000`,
    );
    await page.waitForLoadState("networkidle");

    // Group members are auto-added to the participants step.
    await expect(page.getByText("Bob Fixed")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Carol Fixed")).toBeVisible();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();

    await page.getByRole("radio", { name: "Valores" }).check();

    const aliceInput = page.getByRole("textbox", { name: "Valor que Alice Fixed consumiu" });
    const bobInput = page.getByRole("textbox", { name: "Valor que Bob Fixed consumiu" });
    const carolInput = page.getByRole("textbox", { name: "Valor que Carol Fixed consumiu" });

    // Typing one amount spreads the rest over the people not typed yet, so
    // the split always closes on R$ 150,00.
    await aliceInput.fill("25,00");
    await expect(bobInput).toHaveValue("62,50");
    await expect(carolInput).toHaveValue("62,50");
    await bobInput.fill("50,00");
    await expect(carolInput).toHaveValue("75,00");
    await aliceInput.fill("50,00");
    await expect(carolInput).toHaveValue("50,00");

    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Salvar conta" })).toBeEnabled();
    await page.getByRole("button", { name: "Salvar conta" }).click();
    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, {
      timeout: 15000,
    });

    // Verify the expense landed active with the three R$ 50 shares
    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("id")
            .eq("group_id", group.id)
            .eq("status", "active");
          return data?.length ?? 0;
        },
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);

    const { data: expenses } = await adminClient
      .from("expenses")
      .select("id")
      .eq("group_id", group.id)
      .eq("status", "active");

    const expenseId = expenses![0].id as string;

    const detail = await seed.getExpense(alice.id, expenseId);

    const shareByUser = Object.fromEntries(
      detail.participants.map((p) => [p.user?.id ?? "", p.shareCents]),
    );
    expect(shareByUser[alice.id]).toBe(5000);
    expect(shareByUser[bob.id]).toBe(5000);
    expect(shareByUser[carol.id]).toBe(5000);

    const { data: version } = await adminClient
      .from("expense_versions")
      .select("total_cents")
      .eq("expense_id", expenseId)
      .eq("version_no", 1);
    expect(version).toHaveLength(1);
    expect(version![0].total_cents).toBe(15000);
  });
});
