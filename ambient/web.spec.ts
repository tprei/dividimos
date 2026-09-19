import { mkdirSync } from "node:fs";
import { devices, expect, test } from "@playwright/test";
import { formatBRL } from "../src/lib/currency";
import { loginInContext } from "../e2e/fixtures";
import { BOT_GROUP_NAME, ensureTroupe, type Troupe } from "./bots";
import { firstName, note } from "./diary";

// The walk builds its own context, which inherits the Pixel 7 viewport from
// the config but not recordVideo: video is wired up by Playwright's own
// context fixture, so a hand-built context records nothing unless asked.
// Without this the encode step in the workflow finds no webm and the board
// loses its moving part.
const phone = devices["Pixel 7"].viewport;
if (!phone) {
  throw new Error("ambient: the Pixel 7 profile has no viewport to record at");
}

// The recording is meant to be watched, and the walk on its own flips
// through four screens in about eight seconds, which reads as a
// fast-forward. A beat on each screen after its screenshot gives the board's
// video something a person can actually follow, at the cost of a few seconds
// of a step that has minutes of headroom.
const DWELL_MS = 1400;

let troupe: Troupe;

test.beforeAll(async () => {
  troupe = await ensureTroupe();
});

/**
 * One phone-sized journey where the bots actually use the app: Ana opens the
 * troupe's group, creates an expense through the wizard, takes Bruno's share
 * back through the payment sheet, and says so in the chat. Reading screens
 * proves almost nothing, so every step here writes something a person could
 * have written. The screenshots and the recording are the Telegram board.
 */
test("bot_ana spends and settles through the app", async ({ browser }) => {
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
    await page.waitForTimeout(DWELL_MS);

    // Ana creates the expense the way a person does, through the wizard, not
    // through an RPC: the query carries the title and the total in centavos
    // exactly as the chat shortcut does.
    const totalCents = 2000 + Math.floor(Math.random() * 8000);
    const title = `Pizza da madrugada ${new Date().toISOString().slice(11, 16)}`;
    // The participants are named in the query instead of accepting the
    // wizard's default, which is every member of the group. The owner watches
    // this group and should not wake up owing the bots for a pizza.
    await page.goto(
      `/app/bill/new?groupId=${troupe.groupId}` +
        `&title=${encodeURIComponent(title)}&amount=${totalCents}` +
        `&participantIds=${troupe.bots[0].id},${troupe.bots[1].id}` +
        `&payerId=${troupe.bots[0].id}`,
    );
    const create = page.getByRole("button", { name: "Criar conta" });
    await expect(create).toBeVisible({ timeout: 20000 });
    // Photographed with the payer already chosen: the wizard shows its own
    // "Selecione quem pagou." error until then, and a board that shows an
    // error on a healthy run is worse than no board.
    await page.screenshot({ path: "ambient-shots/2-nova-conta.png" });
    await page.waitForTimeout(DWELL_MS);
    await expect(create).toBeEnabled({ timeout: 20000 });
    await create.click();
    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, { timeout: 30000 });
    note(`Ana criou "${title}" de ${formatBRL(totalCents)} pelo app, dividindo com ${firstName(troupe.bots, troupe.bots[1].id)}`);
    await page.waitForTimeout(DWELL_MS);

    // Then money actually moves: Bruno's share comes back to Ana, recorded
    // from the chat sheet the way a person settles up.
    const bruno = troupe.bots[1];
    await page.goto(`/app/groups/${troupe.groupId}/chat`);
    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    await page.getByTestId(`group-payment-member-${bruno.id}`).click();
    await page.getByTestId("group-payment-payer-other").click();

    // The sheet caps the amount at the debt between the two and offers to
    // clear it. With no debt it offers to record something anyway, and then
    // the amount has to be typed.
    const settleAll = page.getByTestId("group-payment-settle-all");
    const allowOverpay = page.getByTestId("group-payment-allow-overpay");
    if (await settleAll.isVisible()) {
      await settleAll.click();
    } else {
      if (await allowOverpay.isVisible()) await allowOverpay.click();
      const amount = page.getByRole("textbox", { name: "Valor do pagamento" });
      await amount.click();
      await amount.fill("5,00");
    }
    await page.screenshot({ path: "ambient-shots/3-pagamento.png" });
    await page.waitForTimeout(DWELL_MS);

    const settlementCards = page.getByTestId("event-settlement-card");
    const settlementsBefore = await settlementCards.count();
    await page.getByTestId("group-payment-confirm").click();
    await expect(settlementCards).toHaveCount(settlementsBefore + 1, { timeout: 30000 });
    note(`${firstName(troupe.bots, bruno.id)} acertou com Ana pela conversa do grupo`);

    const input = page.getByPlaceholder("Mensagem...");
    await expect(input).toBeVisible({ timeout: 20000 });
    // The text has to be unique per run: two runs in the same minute used to
    // leave two identical bubbles, and the locator then matched both and
    // failed strict mode. The run id is unique per run, and the seconds keep
    // local runs apart too.
    const stamp = process.env.GITHUB_RUN_ID ?? String(Date.now());
    const message = `paguei a pizza, quem falta? #${stamp.slice(-6)}`;
    // Typed rather than injected: fill() sets the value in one frame, so the
    // recording showed the message appearing from nowhere.
    await input.pressSequentially(message, { delay: 45 });
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    // Assert on the bubble, not on any text node: the composer stays disabled
    // with the typed text while the send is in flight, so getByText matches
    // the textarea value too and strict mode refuses the pair.
    await expect(page.getByRole("paragraph").filter({ hasText: message })).toBeVisible({
      timeout: 20000,
    });
    await page.screenshot({ path: "ambient-shots/4-chat.png" });
    await page.waitForTimeout(DWELL_MS);

    note(`Ana escreveu "${message}" no grupo, pelo celular`);
  } finally {
    await ctx.close();
  }
});
