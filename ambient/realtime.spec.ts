import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { formatBRL } from "../src/lib/currency";
import { loginInContext } from "../e2e/fixtures";
import { ensureTroupe, type Troupe } from "./bots";
import { firstName, note } from "./diary";

// The clock starts once the write has committed, so the budget measures the
// broadcast plus one coalesced group refresh plus the render — never the
// write latency itself. Generous for that pipeline, hopeless for a dead
// realtime channel.
const FRESHNESS_BUDGET_MS = 10_000;

let troupe: Troupe;

test.beforeAll(async () => {
  troupe = await ensureTroupe();
});

/**
 * Freshness from the other side of the ledger: Ana records an expense the way
 * the vitest probes do (create_expense as the bot), while Bruno already sits
 * on the group screen in his own browser. The screen he has open has to show
 * the new expense by itself, and the document that shows it has to be the
 * document that was open before the write (performance.timeOrigin) — a reload
 * or a re-navigation would prove nothing about realtime.
 */
test("bot_bruno sees ana's new expense without reloading", async ({ browser }) => {
  const ana = troupe.bots[0];
  const bruno = troupe.bots[1];

  const watcherCtx = await browser.newContext();
  const watcher = await watcherCtx.newPage();
  mkdirSync("ambient-shots", { recursive: true });

  try {
    await loginInContext(watcherCtx, watcher, bruno);
    await watcher.goto(`/app/groups/${troupe.groupId}?tab=contas`);
    await expect(watcher.getByRole("radio", { name: "Contas" })).toBeVisible({
      timeout: 30_000,
    });

    // Wait for the list itself, not just the chrome: a list still loading
    // would surface the new expense from its own fetch and green a dead
    // realtime channel. The empty state counts as settled too; the expense
    // this run creates then becomes the first row.
    const listSettled = watcher
      .locator('a[href^="/app/bill/"]')
      .first()
      .or(watcher.getByText("Nenhuma conta ainda"));
    await expect(listSettled).toBeVisible({ timeout: 30_000 });

    const documentStartedAt = await watcher.evaluate(() => performance.timeOrigin);

    const totalCents = 2000 + Math.floor(Math.random() * 8000);
    // Seconds in the title keep it unique without a run id trailing into the
    // group's history: two runs inside one minute would collide and match
    // both rows in strict mode.
    const title = `Rodada das ${new Date().toTimeString().slice(0, 8)}`;
    await troupe.seed.createExpense(troupe.groupId, ana.id, [ana.id, bruno.id], {
      title,
      totalCents,
    });
    const committedAt = Date.now();

    await expect(watcher.getByText(title, { exact: true })).toBeVisible({
      timeout: FRESHNESS_BUDGET_MS,
    });
    const latencyMs = Date.now() - committedAt;

    expect(await watcher.evaluate(() => performance.timeOrigin)).toBe(documentStartedAt);

    await watcher.screenshot({ path: "ambient-shots/5-realtime.png" });
    note(
      `Realtime: ${firstName(troupe.bots, bruno.id)} viu "${title}" (${formatBRL(totalCents)}) sem recarregar em ${(latencyMs / 1000).toFixed(1)}s`,
    );
  } finally {
    await watcherCtx.close();
  }
});
