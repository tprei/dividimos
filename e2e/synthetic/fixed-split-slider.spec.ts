import { test, expect } from "../fixtures";

test.describe("Fixed-amount split slider", () => {
  test("three participants can independently set fixed amounts via slider pills and activate", async ({
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
      `/app/bill/new?groupId=${group.id}&title=Jantar%20Sintetico&amount=15000`,
    );
    await page.waitForLoadState("networkidle");

    // participants step → amount-split
    await expect(page.getByText("Bob Fixed").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Carol Fixed").first()).toBeVisible();
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();

    // amount-split step: switch to Valor fixo
    await expect(page.getByRole("button", { name: /Valor fixo/i })).toBeVisible();
    await page.getByRole("button", { name: /Valor fixo/i }).click();

    // Regression guard: every participant has an independent slider
    // (the old UI replaced the input with a mutually-exclusive "Restante" button)
    const sliders = page.getByRole("slider");
    await expect(sliders).toHaveCount(3);
    await expect(page.getByRole("slider", { name: /Alice/i })).toBeVisible();
    await expect(page.getByRole("slider", { name: /Bob/i })).toBeVisible();
    await expect(page.getByRole("slider", { name: /Carol/i })).toBeVisible();

    // Initial state: nothing allocated → total mismatch warning shown
    await expect(
      page.getByText(/Total: R\$\s0,00 \(deve ser R\$\s150,00\)/i),
    ).toBeVisible();

    // Set Alice and Bob via their row-scoped "Igual" pills (R$ 50 each)
    // Scope by row to avoid accidentally clicking a disabled button after the first click
    await page
      .locator(".rounded-xl")
      .filter({ hasText: /Alice/i })
      .getByRole("button", { name: /Igual/i })
      .click();
    await page
      .locator(".rounded-xl")
      .filter({ hasText: /Bob/i })
      .getByRole("button", { name: /Igual/i })
      .click();

    // All three sliders must remain rendered after two allocations —
    // this is the direct counter-example to the reported bug.
    await expect(sliders).toHaveCount(3);
    await expect(page.getByRole("slider", { name: /Carol/i })).toBeVisible();

    // Carol completes the bill via her own "Igual" pill.
    // "Restante" is hidden when remainderToComplete === equalShare (both R$ 50),
    // so we click "Igual" instead — same amount, same end state.
    await page
      .locator(".rounded-xl")
      .filter({ hasText: /Carol/i })
      .getByRole("button", { name: /Igual/i })
      .click();

    // Mismatch warning must be gone
    await expect(
      page.getByText(/deve ser R\$\s150,00/i),
    ).not.toBeVisible();

    // Continue through payer → summary → activate
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();

    await page.getByRole("button", { name: alice.name }).click();
    await page
      .getByRole("button", { name: /Próximo|Continuar/i })
      .first()
      .click();

    await page.getByRole("button", { name: /Gerar cobranças Pix/i }).click();
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

    const { data: shares } = await adminClient
      .from("expense_shares")
      .select("user_id, share_amount_cents")
      .eq("expense_id", expenseId);

    const shareByUser = Object.fromEntries(
      (shares ?? []).map((s) => [
        s.user_id as string,
        s.share_amount_cents as number,
      ]),
    );
    expect(shareByUser[alice.id]).toBe(5000);
    expect(shareByUser[bob.id]).toBe(5000);
    expect(shareByUser[carol.id]).toBe(5000);
  });
});
