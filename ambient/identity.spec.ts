import { expect, test } from "@playwright/test";
import { loginInContext } from "../e2e/fixtures";
import { ensureTroupe, type Troupe } from "./bots";
import { note } from "./diary";

// Opt-in: a naming finding should be triaged by a person, not turn the
// scheduled board red. Run with AMBIENT_EXPERIMENTAL=1.
test.skip(process.env.AMBIENT_EXPERIMENTAL !== "1", "set AMBIENT_EXPERIMENTAL=1 to run");

let troupe: Troupe;

test.beforeAll(async () => {
  troupe = await ensureTroupe();
});

interface IdentityScan {
  people: number;
  duplicatedLabels: string[];
  overflowingNames: string[];
}

/**
 * Reads the balances/transfers area the way a member reads it: the @handle
 * under a name identifies the member, so the text right beside it is that
 * member's visible label. Two different members rendering the exact same
 * label, or one member rendering two different labels, is an identity
 * defect; a name wider than its own box is clipped or pushing its row. The
 * balance legend renders "Primeiro 12,34" per participant, so two identical
 * legends are again two members sharing one label.
 */
function scanIdentity(): IdentityScan {
  const sections = document.querySelectorAll(
    'section[aria-label="Saldo consolidado"], section[aria-label="Transferências"]',
  );
  const visible = (el: Element): boolean =>
    getComputedStyle(el).visibility !== "hidden" && el.getClientRects().length > 0;

  const duplicated: string[] = [];
  const overflowing: string[] = [];
  const handleByLabel = new Map<string, string>();
  const labelByHandle = new Map<string, string>();
  const legendCounts = new Map<string, number>();

  for (const section of Array.from(sections)) {
    for (const el of Array.from(section.querySelectorAll<HTMLElement>("*"))) {
      if (!visible(el)) continue;
      // Only leaves carry a person label of their own; a container's text
      // merges everyone in it.
      if (el.children.length !== 0) continue;

      const own = (el.textContent ?? "").trim();

      if (/^@[\w.-]+$/.test(own)) {
        const nameEl = el.previousElementSibling;
        if (nameEl === null) continue;
        const name = (nameEl.textContent ?? "").trim();
        if (name === "") continue;
        const handle = own.slice(1);

        const otherHandle = handleByLabel.get(name);
        if (otherHandle !== undefined && otherHandle !== handle) {
          duplicated.push(`"${name}" renders for @${otherHandle} and @${handle}`);
        }
        const otherLabel = labelByHandle.get(handle);
        if (otherLabel !== undefined && otherLabel !== name) {
          duplicated.push(`@${handle} renders as "${otherLabel}" and "${name}"`);
        }
        handleByLabel.set(name, handle);
        labelByHandle.set(handle, name);

        if (nameEl.scrollWidth > nameEl.clientWidth) {
          overflowing.push(
            `@${handle} "${name}" is ${nameEl.scrollWidth}px in a ${nameEl.clientWidth}px box`,
          );
        }
        continue;
      }

      if (!own.includes("R$") && /^.+\s\d[\d.]*,\d{2}$/.test(own)) {
        const count = (legendCounts.get(own) ?? 0) + 1;
        legendCounts.set(own, count);
        if (count === 2) duplicated.push(`"${own}" renders for two members`);
      }
    }
  }

  return {
    people: labelByHandle.size,
    duplicatedLabels: [...new Set(duplicated)],
    overflowingNames: overflowing,
  };
}

/**
 * One bot opens the group's settlement screen. Every member has to appear as
 * exactly one visible label, and names have to fit their own box: the row a
 * person reads to know who pays whom cannot be ambiguous or clipped.
 */
test("[experimental] every member renders one label that fits", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    await loginInContext(ctx, page, troupe.bots[2]);
    await page.goto(`/app/groups/${troupe.groupId}`);
    await expect(page.getByRole("tab", { name: "Saldos" })).toBeVisible({ timeout: 30_000 });

    // A settled group has nothing to read; one expense between two bots
    // gives the area members to render.
    const rows = page.locator('[id^="transfer-"]');
    await expect(rows.first().or(page.getByText("Tudo liquidado!"))).toBeVisible({
      timeout: 30_000,
    });
    if ((await rows.count()) === 0) {
      const ana = troupe.bots[0];
      const bruno = troupe.bots[1];
      await troupe.seed.createExpense(troupe.groupId, ana.id, [ana.id, bruno.id], {
        title: "Sonda de identidade",
        totalCents: 4321,
      });
      await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    }

    const scan = await page.evaluate(scanIdentity);
    expect(scan.duplicatedLabels, "one visible label per member").toEqual([]);
    expect(scan.overflowingNames, "names fit their row").toEqual([]);
    note(`Identidade: ${scan.people} pessoas no acerto, cada uma com um rótulo único e inteiro`);
  } finally {
    await ctx.close();
  }
});
