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

    // Group members are auto-added; their names show inside the sheet.
    await page.getByRole("button", { name: "Participantes" }).click();
    await expect(page.getByText("Bob Fixed").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Carol Fixed").first()).toBeVisible();
    await page.getByRole("button", { name: "Concluir" }).click();
    await page.getByRole("button", { name: "Continuar" }).click();

    await page.getByRole("radio", { name: "Fixo" }).click();

    const aliceInput = page.getByRole("textbox", { name: "Valor de Alice Fixed" });
    const bobInput = page.getByRole("textbox", { name: "Valor de Bob Fixed" });
    const carolInput = page.getByRole("textbox", { name: "Valor de Carol Fixed" });

    // Carol's untouched input keeps the even 50,00 fallback, so two 25,00
    // fills leave the split short of R$ 150,00.
    await aliceInput.fill("25,00");
    await bobInput.fill("25,00");
    await expect(page.getByText(/falta R\$\s*50,00/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar conta" })).toBeDisabled();

    await aliceInput.fill("50,00");
    await bobInput.fill("50,00");
    await carolInput.fill("50,00");
    await expect(page.getByText(/falta R\$\s*50,00/)).toHaveCount(0);

    await page.getByRole("button", { name: /Alice/ }).click();
    await expect(page.getByRole("button", { name: "Criar conta" })).toBeEnabled();
    await page.getByRole("button", { name: "Criar conta" }).click();
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

    const { data: participants } = await adminClient
      .from("expense_participants")
      .select("user_id, share_cents")
      .eq("expense_id", expenseId);

    const shareByUser = Object.fromEntries(
      (participants ?? []).map((p) => [
        p.user_id as string,
        p.share_cents as number,
      ]),
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
