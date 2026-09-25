import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";

const EDGE_GAP_PX = 8;

async function cardsTouchingEdges(page: Page): Promise<string[]> {
  return page.evaluate((gap) => {
    const width = window.innerWidth;
    const offenders: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("main *, body > div *")) {
      if (element.closest("nav, [role=dialog], [data-slot=popover-content]")) continue;
      const style = getComputedStyle(element);
      if (style.position === "fixed") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 24 || rect.bottom < 0) continue;
      const rounded = parseFloat(style.borderTopLeftRadius) >= 12;
      const bordered = parseFloat(style.borderLeftWidth) > 0 || parseFloat(style.borderRightWidth) > 0;
      if (rounded && bordered && (rect.left < gap || rect.right > width - gap)) {
        offenders.push(`${Math.round(rect.left)}..${Math.round(rect.right)} "${(element.textContent ?? "").trim().slice(0, 40)}"`);
      }
    }
    return [...new Set(offenders)];
  }, EDGE_GAP_PX);
}

test.describe("Layout gutters on a small phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("cards keep the page gutter and nothing scrolls sideways", async ({ page, seed, loginAs }) => {
    const alice = await seed.createUser({ name: "Alice Margem" });
    const bob = await seed.createUser({ name: "Bob Margem Com Um Nome Bem Comprido" });
    const group = await seed.createGroup(alice.id, [bob.id], "Churrasco de domingo na casa da Alice");
    const expense = await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Carne, carvão e cerveja pro churrasco inteiro",
      totalCents: 38750,
    });

    await loginAs(alice);
    const routes = [
      "/app",
      "/app/groups",
      `/app/groups/${group.id}`,
      `/app/groups/${group.id}?tab=contas`,
      `/app/groups/${group.id}?tab=membros`,
      `/app/groups/${group.id}/info`,
      `/app/bill/${expense.id}`,
      "/app/bills",
      "/app/activity",
      "/app/profile",
      "/app/settings",
      `/app/conversations/${bob.id}`,
    ];

    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20000 });
      await page.waitForLoadState("networkidle");
      expect(await cardsTouchingEdges(page), route).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        route,
      ).toBe(true);
    }
  });
});