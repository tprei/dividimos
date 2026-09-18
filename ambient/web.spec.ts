import { test, expect } from "@playwright/test";
import { loginInContext } from "../e2e/fixtures";
import { BOT_GROUP_NAME, ensureTroupe, type Troupe } from "./bots";

let troupe: Troupe;

test.beforeAll(async () => {
  troupe = await ensureTroupe();
});

test("bot_ana sees the troupe group and a bot badge", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await loginInContext(ctx, page, troupe.bots[0]);
    await page.goto("/app/groups");
    const groupLink = page.getByRole("link", { name: new RegExp(BOT_GROUP_NAME) });
    await expect(groupLink).toBeVisible({ timeout: 20000 });
    await groupLink.click();
    await page.getByRole("tab", { name: "Membros" }).click();
    await expect(page.getByRole("img", { name: "Bot verificado" }).first()).toBeVisible({
      timeout: 20000,
    });
  } finally {
    await ctx.close();
  }
});
