import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { loginInContext } from "../e2e/fixtures";
import { BOT_GROUP_NAME, ensureTroupe, type Troupe } from "./bots";
import { note } from "./diary";

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
    mkdirSync("ambient-shots", { recursive: true });
    await page.screenshot({ path: "ambient-shots/1-group.png" });

    await page.getByRole("tab", { name: "Contas" }).click();
    await expect(page.getByRole("tab", { name: "Contas" })).toBeVisible();
    await page.screenshot({ path: "ambient-shots/2-expenses.png" });

    await page.goto("/u/bot_ana");
    await expect(page.getByText("Bot verificado")).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "ambient-shots/3-profile.png" });
    note("bot_ana browsed the group members, the expense list, and her own profile");
  } finally {
    await ctx.close();
  }
});
