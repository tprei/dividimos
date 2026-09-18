import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { loginInContext } from "../e2e/fixtures";
import { BOT_GROUP_NAME, ensureTroupe, type Troupe } from "./bots";
import { note } from "./diary";

let troupe: Troupe;

test.beforeAll(async () => {
  troupe = await ensureTroupe();
});

/**
 * One phone-sized journey through what the bots just did: the group the
 * troupe shares, the balances their settlement moved, the expenses they
 * created this run, and a message Ana types herself. The screenshots and the
 * recording of this walk are what the Telegram board shows.
 */
test("bot_ana walks the group the troupe just changed", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  mkdirSync("ambient-shots", { recursive: true });

  try {
    await loginInContext(ctx, page, troupe.bots[0]);

    await page.goto("/app/groups");
    const groupLink = page.getByRole("link", { name: new RegExp(BOT_GROUP_NAME) });
    await expect(groupLink).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "ambient-shots/1-groups.png" });

    await groupLink.click();
    await expect(page.getByRole("tab", { name: "Saldos" })).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "ambient-shots/2-balances.png" });

    await page.getByRole("tab", { name: "Contas" }).click();
    await expect(page.getByRole("tab", { name: "Contas" })).toHaveAttribute(
      "data-state",
      "active",
    );
    await page.screenshot({ path: "ambient-shots/3-expenses.png" });

    await page.getByRole("tab", { name: "Membros" }).click();
    await expect(page.getByRole("img", { name: "Bot verificado" }).first()).toBeVisible({
      timeout: 20000,
    });

    // The one action a person takes in this walk: Ana types into the group
    // chat and sends it. The recording shows the keystrokes and the bubble.
    const groupUrl = new URL(page.url());
    await page.goto(`${groupUrl.pathname}/chat`);
    const input = page.getByPlaceholder("Mensagem...");
    await expect(input).toBeVisible({ timeout: 20000 });
    const message = `passei aqui pelo celular ${new Date().toISOString().slice(11, 16)}`;
    await input.fill(message);
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(page.getByText(message)).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "ambient-shots/4-chat.png" });

    note(`Ana opened the group on a phone and sent "${message}" in the chat`);
  } finally {
    await ctx.close();
  }
});
