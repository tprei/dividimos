import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import type { SeedHelper } from "../seed-helper";

async function seedNotifiedGroup(seed: SeedHelper, label: string) {
  const owner = await seed.createUser({ name: `Alice ${label}` });
  const other = await seed.createUser({ name: `Bob ${label}` });
  const group = await seed.createGroup(owner.id, [other.id], `Grupo ${label}`);
  await seed.createExpense(group.id, owner.id, [owner.id, other.id], {
    title: `Conta ${label}`,
    totalCents: 6000,
    expenseType: "single_amount",
  });
  return { owner, group, title: `Conta ${label}` };
}

async function openBell(page: Page, groupId: string) {
  await page.goto(`/app/groups/${groupId}`);
  await page.getByRole("button", { name: /^Notificações/ }).click();
}

test.describe("Notification rows can be marked read or dismissed", () => {
  // Without a pointer, the row exposes the same two actions inline, so this is
  // the engine-independent way to drive them.
  test.describe("without the gesture", () => {
    test("dismissing a row removes it and the dismissal outlives a reload", async ({
      page,
      seed,
      loginAs,
    }) => {
      const { owner, group, title } = await seedNotifiedGroup(seed, "Sino");
      await loginAs(owner);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openBell(page, group.id);

      const row = page.getByRole("listitem").filter({ hasText: title }).first();
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "Dispensar" }).click();

      await expect(page.getByText(title)).toHaveCount(0);

      await page.reload();
      await page.getByRole("button", { name: /^Notificações/ }).click();
      await expect(page.getByText(title)).toHaveCount(0);
    });

    test("marking a row as read clears its unread marker", async ({ page, seed, loginAs }) => {
      const { owner, group, title } = await seedNotifiedGroup(seed, "Lida");
      await loginAs(owner);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openBell(page, group.id);

      const row = page.getByRole("listitem").filter({ hasText: title }).first();
      await expect(row.locator("[data-testid^='unread-dot-']")).toBeVisible();

      await row.getByRole("button", { name: "Marcar como lida" }).click();

      await expect(row.locator("[data-testid^='unread-dot-']")).toHaveCount(0);
      await expect(row.getByRole("button", { name: "Marcar como lida" })).toHaveCount(0);
      await expect(row.getByRole("button", { name: "Dispensar" })).toBeVisible();
    });
  });

  test.describe("with a swipe", () => {
    // Framer's drag listens to pointer events a synthetic mouse does not
    // satisfy; injecting touch needs CDP, which only Chromium exposes.
    test.skip(({ browserName }) => browserName !== "chromium", "touch injection is Chromium-only");

    test("swiping a row left reveals the actions and dismisses it", async ({
      page,
      context,
      seed,
      loginAs,
    }) => {
      const { owner, group, title } = await seedNotifiedGroup(seed, "Arrasto");
      await loginAs(owner);
      await openBell(page, group.id);

      const row = page.getByRole("listitem").filter({ hasText: title }).first();
      const box = (await row.boundingBox())!;
      const y = box.y + box.height / 2;
      const startX = box.x + box.width - 20;

      const cdp = await context.newCDPSession(page);
      const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
        cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
        });

      await touch("touchStart", startX);
      for (let step = 1; step <= 10; step++) {
        await touch("touchMove", startX - step * 20);
        await page.waitForTimeout(20);
      }
      await touch("touchEnd", startX - 200);

      const dismiss = row.getByRole("button", { name: "Dispensar" });
      await expect(dismiss).toBeVisible();
      await dismiss.click();

      await expect(page.getByText(title)).toHaveCount(0);
    });
  });
});
