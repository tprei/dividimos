import { test, expect } from "../fixtures";
import type { BrowserContext, Page } from "@playwright/test";
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

test.describe("Notification rows can be discarded", () => {
  // Without a pointer, the row exposes the same action inline, so this is
  // the engine-independent way to drive it.
  test.describe("without the gesture", () => {
    test("discarding a row removes it and the discard outlives a reload", async ({
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
      await row.getByRole("button", { name: "Descartar" }).click();

      await expect(page.getByText(title)).toHaveCount(0);

      await page.reload();
      await page.getByRole("button", { name: /^Notificações/ }).click();
      await expect(page.getByText(title)).toHaveCount(0);
    });

    test("discarding all empties the preview and stays empty after reopening", async ({ page, seed, loginAs }) => {
      const { owner, group, title } = await seedNotifiedGroup(seed, "Todas");
      await loginAs(owner);
      await openBell(page, group.id);
      await expect(page.getByText(title)).toBeVisible();
      await page.getByRole("button", { name: "Descartar todas" }).click();
      await expect(page.getByText(title)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Notificações/ }).click();
      await expect(page.getByText(title)).toHaveCount(0);
    });

    test("opening a notification navigates to its bill and marks it read", async ({ page, seed, loginAs }) => {
      const { owner, group, title } = await seedNotifiedGroup(seed, "Abrir");
      await loginAs(owner);
      await openBell(page, group.id);
      const row = page.getByRole("listitem").filter({ hasText: title }).first();
      await row.getByRole("link").click();
      await expect(page).toHaveURL(/\/app\/bill\/[a-f0-9-]+$/);
      await openBell(page, group.id);
      await expect(page.getByRole("listitem").filter({ hasText: title }).first().locator("[data-testid^='unread-dot-']")).toHaveCount(0);
    });
  });

  test.describe("with a swipe", () => {
    // Framer's drag listens to pointer events a synthetic mouse does not
    // satisfy; injecting touch needs CDP, which only Chromium exposes.
    test.skip(({ browserName }) => browserName !== "chromium", "touch injection is Chromium-only");

    async function swipeLeft(page: Page, context: BrowserContext, title: string, distance: number) {
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

      const steps = 12;
      await touch("touchStart", startX);
      for (let step = 1; step <= steps; step++) {
        await touch("touchMove", startX - (step * distance) / steps);
        await page.waitForTimeout(24);
      }
      await touch("touchEnd", startX - distance);
      return { row, cdp };
    }

    test("a full swipe discards the row", async ({ page, context, seed, loginAs }) => {
      const { owner, group, title } = await seedNotifiedGroup(seed, "Arrasto");
      await loginAs(owner);
      await openBell(page, group.id);

      const row = page.getByRole("listitem").filter({ hasText: title }).first();
      const width = (await row.boundingBox())!.width;
      await swipeLeft(page, context, title, width * 0.7);

      await expect(page.getByText(title)).toHaveCount(0);
    });

    test("a short swipe reveals Descartar and a touch on it discards the row", async ({
      page,
      context,
      seed,
      loginAs,
    }) => {
      const { owner, group, title } = await seedNotifiedGroup(seed, "Revelar");
      await loginAs(owner);
      await openBell(page, group.id);

      const { row, cdp } = await swipeLeft(page, context, title, 80);
      const discard = row.getByRole("button", { name: "Descartar" });
      await expect(discard).toBeVisible();
      await expect(page.getByText(title)).toBeVisible();

      const target = (await discard.boundingBox())!;
      const point = { x: target.x + target.width / 2, y: target.y + target.height / 2, id: 1 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

      await expect(page.getByText(title)).toHaveCount(0);
    });
  });
});
