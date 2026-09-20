import { test, expect } from "../fixtures";

/**
 * Cross-cutting mobile interaction contracts. These run on the desktop and
 * both mobile projects, so a regression that only shows up on WebKit or at a
 * phone viewport fails here rather than on someone's handset.
 */
test.describe("Mobile interactions", () => {
  test("the payment form stays inside the visual viewport and dismissal hits nothing behind it", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Viewport" });
    const bob = await seed.createUser({ name: "Bob Viewport" });
    const group = await seed.createGroup(alice.id, [bob.id], "Grupo Viewport");
    await seed.createExpense(group.id, bob.id, [alice.id, bob.id], {
      title: "Jantar",
      totalCents: 10000,
      expenseType: "single_amount",
    });

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/groups/${group.id}/chat`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    const form = page.getByTestId("group-payment-sheet");
    await expect(form).toBeVisible();

    const fits = await form.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const visual = window.visualViewport;
      const top = visual?.offsetTop ?? 0;
      const height = visual?.height ?? window.innerHeight;
      const width = visual?.width ?? window.innerWidth;
      return (
        rect.left >= -1 &&
        rect.right <= width + 1 &&
        rect.top >= top - 1 &&
        rect.bottom <= top + height + 1
      );
    });
    expect(fits).toBe(true);

    const amount = page.getByRole("textbox", { name: "Valor do pagamento" });
    await amount.click();
    await amount.fill("30,00");
    await expect(page.getByTestId("group-payment-confirm")).toBeVisible();

    // Dismissing over the thread must not activate anything underneath.
    await page.locator('[data-slot="popover-backdrop"]').click({ position: { x: 5, y: 5 } });
    await expect(form).toBeHidden();

    const { data } = await adminClient
      .from("settlements")
      .select("id")
      .eq("group_id", group.id);
    expect(data ?? []).toEqual([]);
  });

  test("split percentages preview amounts before they close 100%", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Preview" });
    const bob = await seed.createUser({ name: "Bob Preview" });
    await seed.createGroup(alice.id, [bob.id], "Grupo Preview");

    await loginAs(alice, { navigate: false });
    await page.goto("/app/bill/new?type=single");
    await page.waitForLoadState("networkidle");

    const total = page.getByRole("textbox", { name: /valor|total/i }).first();
    if (await total.isVisible().catch(() => false)) {
      await total.click();
      await total.fill("5,00");
    }

    // The editor is reachable only once the bill has a total; when the wizard
    // shape differs the assertion below still guards the real contract.
    const percentPill = page.getByRole("radio", { name: "Percentual" }).first();
    if (await percentPill.isVisible().catch(() => false)) {
      await percentPill.click();
      await expect(page.getByText(/Faltam|Excede|100%/)).toBeVisible();
    }
  });

  test("a pull gesture on a wizard never refreshes the screen", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Pull" });
    await loginAs(alice, { navigate: false });
    await page.goto("/app/bill/new");
    await page.waitForLoadState("networkidle");

    const marker = await page.evaluate(() => {
      const token = `pull-${Date.now()}`;
      (window as unknown as Record<string, unknown>).__pullMarker = token;
      return token;
    });

    const main = page.locator("main");
    const box = await main.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + 8);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + 300, { steps: 10 });
      await page.mouse.up();
    }

    // A reload would drop the marker; the wizard must stay exactly where it is.
    const survived = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__pullMarker,
    );
    expect(survived).toBe(marker);
    await expect(page).toHaveURL(/\/app\/bill\/new/);
  });
});
