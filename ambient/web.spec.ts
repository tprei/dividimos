import { mkdirSync } from "node:fs";
import { devices, expect, test } from "@playwright/test";
import { loginInContext } from "../e2e/fixtures";
import { BOT_GROUP_NAME, ensureTroupe, type Troupe } from "./bots";
import { note } from "./diary";

// The walk builds its own context, which inherits the Pixel 7 viewport from
// the config but not recordVideo: video is wired up by Playwright's own
// context fixture, so a hand-built context records nothing unless asked.
// Without this the encode step in the workflow finds no webm and the board
// loses its moving part.
const phone = devices["Pixel 7"].viewport;
if (!phone) {
  throw new Error("ambient: the Pixel 7 profile has no viewport to record at");
}

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
  const ctx = await browser.newContext({
    recordVideo: { dir: "test-results/ambient-video", size: phone },
  });
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
    // Base UI marks the selected tab with aria-selected and a valueless
    // data-active; there is no data-state="active" to wait for.
    await expect(page.getByRole("tab", { name: "Contas" })).toHaveAttribute(
      "aria-selected",
      "true",
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
    // The text has to be unique per run: two runs in the same minute used to
    // leave two identical bubbles, and the locator then matched both and
    // failed strict mode. The run id is unique per run, and the seconds keep
    // local runs apart too.
    const stamp = process.env.GITHUB_RUN_ID ?? String(Date.now());
    const message = `passei aqui pelo celular ${new Date().toISOString().slice(11, 19)} #${stamp.slice(-6)}`;
    await input.fill(message);
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    // Assert on the bubble, not on any text node: the composer stays disabled
    // with the typed text while the send is in flight, so getByText matches
    // the textarea value too and strict mode refuses the pair.
    await expect(page.getByRole("paragraph").filter({ hasText: message })).toBeVisible({
      timeout: 20000,
    });
    await page.screenshot({ path: "ambient-shots/4-chat.png" });

    note(`Ana opened the group on a phone and sent "${message}" in the chat`);
  } finally {
    await ctx.close();
  }
});
