import { test, expect } from "../fixtures";

async function swipeCardLeft(page: import("@playwright/test").Page, title: string) {
  const billLink = page.getByRole("link", { name: new RegExp(title) }).first();
  await expect(billLink).toBeVisible({ timeout: 10000 });
  const card = page.locator("div.relative.overflow-hidden", { has: billLink }).first();
  const box = await card.boundingBox();
  if (!box) throw new Error(`Could not find bounding box for card with "${title}"`);

  const startX = box.x + box.width - 50;
  const startY = box.y + box.height / 2;

  await page.evaluate(
    async ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) throw new Error("No element found at start point");
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerId: 1,
          isPrimary: true,
        }),
      );
      for (let i = 1; i <= 10; i++) {
        const currentX = x - (150 * i) / 10;
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            clientX: currentX,
            clientY: y,
            pointerId: 1,
            isPrimary: true,
          }),
        );
        await new Promise((r) => setTimeout(r, 20));
      }
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX: x - 150,
          clientY: y,
          pointerId: 1,
          isPrimary: true,
        }),
      );
    },
    { x: startX, y: startY },
  );

  await page.waitForTimeout(600);
}

test.describe("Swipeable Bill Card Actions", () => {
  test("swipe hint chevron is visible on active bill cards", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Swipe" });
    const bob = await seed.createUser({ name: "Bob Swipe" });
    const group = await seed.createGroup(alice.id, [bob.id], "Swipe Hint Group");

    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Almoço Chevron",
      totalCents: 6000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.goto("/app/bills");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Suas contas" })).toBeVisible({ timeout: 10000 });
    const billLink = page.getByRole("link", { name: /Almoço Chevron/ });
    await expect(billLink).toBeVisible();

    const card = billLink.locator("..");
    const chevron = card.locator("svg.lucide-chevron-left");
    await expect(chevron).toBeVisible();
  });

  test("swiping left reveals delete button", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice SwipeReveal" });
    const bob = await seed.createUser({ name: "Bob SwipeReveal" });
    const group = await seed.createGroup(alice.id, [bob.id], "Swipe Reveal Group");

    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Jantar Reveal",
      totalCents: 8000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.goto("/app/bills");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Jantar Reveal")).toBeVisible({ timeout: 10000 });

    await swipeCardLeft(page, "Jantar Reveal");

    const deleteButton = page.getByRole("button", { name: /excluir conta/i }).first();
    await expect(deleteButton).toBeVisible();
  });

  test("swipe then cancel delete keeps the bill active", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice SwipeCancel" });
    const bob = await seed.createUser({ name: "Bob SwipeCancel" });
    const group = await seed.createGroup(alice.id, [bob.id], "Swipe Cancel Group");

    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Conta Mantida",
      totalCents: 5000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.goto("/app/bills");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Conta Mantida")).toBeVisible({ timeout: 10000 });

    await swipeCardLeft(page, "Conta Mantida");

    const deleteButton = page.getByRole("button", { name: /excluir conta/i }).first();
    await deleteButton.click();

    // Dialog appears
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByText("Excluir conta?")).toBeVisible();
    await expect(page.getByText("Essa ação não tem volta.")).toBeVisible();

    // Cancel deletion
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).not.toBeVisible();

    // Bill still present and active
    await expect(page.getByText("Conta Mantida")).toBeVisible();
    await expect(page.getByText("Excluída")).toHaveCount(0);
  });

  test("swipe then confirm delete marks bill as deleted", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice SwipeDelete" });
    const bob = await seed.createUser({ name: "Bob SwipeDelete" });
    const group = await seed.createGroup(alice.id, [bob.id], "Swipe Delete Group");

    const expense = await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Conta Para Excluir",
      totalCents: 9000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.goto("/app/bills");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Conta Para Excluir")).toBeVisible({ timeout: 10000 });

    await swipeCardLeft(page, "Conta Para Excluir");

    const deleteButton = page.getByRole("button", { name: /excluir conta/i }).first();
    await deleteButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: /^Excluir$/ }).click();

    await expect(dialog).not.toBeVisible();

    // The card now shows the "Excluída" badge
    await expect(page.getByText("Excluída").first()).toBeVisible({ timeout: 10000 });

    // In DB, status is deleted
    const { data: rows } = await adminClient
      .from("expenses")
      .select("status")
      .eq("id", expense.id);
    expect(rows?.[0]?.status).toBe("deleted");
  });

  test("deleted bills do not have swipe actions", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice DeletedNoSwipe" });
    const bob = await seed.createUser({ name: "Bob DeletedNoSwipe" });
    const group = await seed.createGroup(alice.id, [bob.id], "Deleted Group");

    const expense = await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Conta Ja Deletada",
      totalCents: 4000,
      expenseType: "single_amount",
    });

    // Mark deleted in database
    await adminClient
      .from("expenses")
      .update({ status: "deleted" })
      .eq("id", expense.id);

    await loginAs(alice);
    await page.goto("/app/bills");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Conta Ja Deletada")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Excluída").first()).toBeVisible();

    // Deleted card does not have the swipe hint chevron or delete action button
    const card = page.getByRole("link", { name: /Conta Ja Deletada/ }).locator("..");
    await expect(card.locator("svg.lucide-chevron-left")).toHaveCount(0);
    await expect(card.getByRole("button", { name: /excluir conta/i })).toHaveCount(0);
  });
});
