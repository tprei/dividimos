import QRCode from "qrcode";
import { devices } from "@playwright/test";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";

/**
 * The reported room defects, exercised on real phone screens: the room would
 * not scroll, there was nowhere to invite anybody, and taking half of a
 * one-unit item made the other half vanish.
 */

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const ROOM_TIMEOUT = 5_000;
const MERCHANT = "HMSHost Helsinki";
type RoomList = "Itens" | "Disponíveis" | "Minha parte";

interface OcrItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

/** Two one-unit lines, matching the receipt in the bug report. */
const TWO_LINES: OcrItem[] = [
  { description: "Toast Bacon Egg", quantity: 1, unitPriceCents: 690, totalCents: 690 },
  { description: "Caffe Latte S", quantity: 1, unitPriceCents: 510, totalCents: 510 },
];

function longReceipt(): OcrItem[] {
  return Array.from({ length: 12 }, (_, index) => ({
    description: `Item longo número ${index + 1}`,
    quantity: 1,
    unitPriceCents: 100 + index,
    totalCents: 100 + index,
  }));
}

function row(page: Page, list: RoomList, description: string): Locator {
  return page
    .getByRole("region", { name: list })
    .locator("li[data-item-id]")
    .filter({ has: page.getByText(description, { exact: true }) });
}

function rowButton(page: Page, list: RoomList, description: string): Locator {
  return row(page, list, description).getByRole("button", {
    name: new RegExp(`(Escolher quantidade de|Editar escolhas de) ${description}`),
  });
}

async function recordClipboard(context: BrowserContext): Promise<void> {
  // WebKit refuses the clipboard permissions Chromium grants, so the test
  // records what the app copies instead of reading a real clipboard.
  await context.addInitScript(() => {
    const record = (text: string) => {
      (window as unknown as { __copiedText?: string }).__copiedText = text;
      return Promise.resolve();
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: record, readText: () => Promise.resolve("") },
    });
  });
}

async function stubOcr(page: Page, items: OcrItem[]): Promise<void> {
  const totalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
  await page.route("**/api/receipt/ocr", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        merchant: MERCHANT,
        items,
        serviceFeeBasisPoints: 0,
        fixedFeesCents: 0,
        totalCents,
      }),
    });
  });
}

async function waitForRoom(page: Page): Promise<void> {
  // The invitation opens over the board on arrival, and a modal takes the
  // background out of the accessibility tree, so the wait uses text rather
  // than the heading role.
  await page.waitForURL(/\/room\/[0-9a-f-]{36}/i, { timeout: 20_000 });
  await expect(page.getByText(MERCHANT).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Reconectando.", { exact: false })).toBeHidden({
    timeout: 20_000,
  });
}

/** Scan a receipt and open its room, returning the copied invitation. */
async function openRoom(page: Page, items: OcrItem[]): Promise<string> {
  await stubOcr(page, items);
  await page.goto("/app/bill/new?scan=true");
  await page.locator('input[type="file"]:not([capture])').setInputFiles({
    name: "recibo.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await page.getByRole("button", { name: "Processar" }).click();
  await expect(page.getByRole("heading", { name: "Recibo" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Criar sala de divisão" }).click();
  await waitForRoom(page);

  const invite = page.getByRole("dialog", { name: "Convide o pessoal" });
  await expect(invite).toBeVisible();
  await invite.getByRole("button", { name: "Copiar link" }).click();
  await expect(invite.getByRole("button", { name: "Link copiado" })).toBeVisible();
  const invitation = await page.evaluate<string>("window.__copiedText ?? ''");
  await invite.getByRole("button", { name: "Voltar para a sala" }).click();
  await expect(invite).toBeHidden();
  return invitation;
}

function localInvitation(invitation: string): string {
  const url = new URL(invitation);
  return `${url.pathname}${url.hash}`;
}

async function joinAsGuest(page: Page, invitation: string, name: string): Promise<void> {
  await page.goto(localInvitation(invitation));
  await page.getByRole("textbox", { name: "Seu nome" }).fill(name);
  await page.getByRole("button", { name: "Entrar na sala" }).click();
  await waitForRoom(page);
}

async function chooseFraction(
  page: Page,
  list: RoomList,
  description: string,
  fraction: string,
): Promise<Locator> {
  await rowButton(page, list, description).click();
  const dialog = page.getByRole("dialog", { name: description });
  await dialog.getByRole("button", { name: fraction, exact: true }).click();
  return dialog;
}

/**
 * Sample the drawn QR back into a module matrix. The three finder patterns sit
 * in the extreme corners of the code area, so the dark-pixel bounding box is
 * exactly that area and each module centre can be read directly.
 */
async function readQrModules(page: Page, size: number): Promise<number[]> {
  return page.evaluate((moduleCount) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="QR code do convite"]',
    );
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return [];
    const { width, height } = canvas;
    const { data } = context.getImageData(0, 0, width, height);
    const isDark = (x: number, y: number) => data[(y * width + x) * 4] < 128;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!isDark(x, y)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return [];
    const cell = (maxX - minX + 1) / moduleCount;
    const modules: number[] = [];
    for (let row = 0; row < moduleCount; row += 1) {
      for (let column = 0; column < moduleCount; column += 1) {
        const x = Math.floor(minX + (column + 0.5) * cell);
        const y = Math.floor(minY + (row + 0.5) * cell);
        modules.push(isDark(x, y) ? 1 : 0);
      }
    }
    return modules;
  }, size);
}


/**
 * A joiner scans the QR on their own phone, so joiner contexts use the real
 * iPhone and Pixel descriptors. WebKit rejects `isMobile`, so that single flag
 * is dropped there while the screen, scale, touch and user agent stay.
 */
function phoneContext(browser: Browser, model: "iPhone 13" | "Pixel 5") {
  const { defaultBrowserType, isMobile, ...screen } = devices[model];
  void defaultBrowserType;
  return browser.browserType().name() === "webkit"
    ? screen
    : { ...screen, isMobile };
}

test.describe("Assignment room on a phone", () => {
  test.setTimeout(180_000);

  test("brings an account and a guest in from the first screen", async ({
    adminClient,
    browser,
    context,
    loginAs,
    newSession,
    page,
    seed,
  }) => {
    const host = await seed.createUser({ name: "Ana Anfitriã" });
    const member = await seed.createUser({ name: "Rui Conectado" });
    let guestContext: BrowserContext | null = null;

    await recordClipboard(context);
    await loginAs(host, { navigate: false });
    const invitation = await openRoom(page, TWO_LINES);
    const roomId = new URL(page.url()).pathname.split("/").at(-1) as string;
    expect(invitation).toMatch(new RegExp(`/room/${roomId}#armj1_`));

    // The invitation must be reachable without scrolling the room at all.
    const invite = page.getByRole("button", { name: "Convidar" });
    const viewport = page.viewportSize();
    const box = await invite.boundingBox();
    expect(box).not.toBeNull();
    if (box && viewport) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }

    // The rendered QR must carry the same invitation the copy button produced.
    // Reading the drawn modules back and comparing them with the library's
    // encoding of that URL is the same check a scanner performs.
    await invite.click();
    const inviteDialog = page.getByRole("dialog", { name: "Convide o pessoal" });
    await expect(inviteDialog.getByLabel("QR code do convite")).toBeVisible();
    const expected = QRCode.create(invitation, {}).modules;
    await expect
      .poll(() => readQrModules(page, expected.size), { timeout: ROOM_TIMEOUT })
      .toEqual(Array.from(expected.data, (bit) => (bit ? 1 : 0)));
    await inviteDialog.getByRole("button", { name: "Voltar para a sala" }).click();

    // A signed-in invitee joins as themselves and never types a name; an
    // anonymous invitee still gets the guest form.
    const memberSession = await newSession(member);
    await memberSession.page.goto(localInvitation(invitation));
    await expect(
      memberSession.page.getByText(new RegExp(`Você entra como ${member.name}`)),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      memberSession.page.getByRole("textbox", { name: "Seu nome" }),
    ).toHaveCount(0);
    await memberSession.page.getByRole("button", { name: "Entrar na sala" }).click();
    await waitForRoom(memberSession.page);

    guestContext = await browser.newContext(phoneContext(browser, "Pixel 5"));
    const guestPage = await guestContext.newPage();
    try {
      await joinAsGuest(guestPage, invitation, "Bia Convidada");

      const roster = page.getByRole("region", { name: "Na sala" });
      await expect(roster.getByText("3 pessoas na sala")).toBeVisible({
        timeout: ROOM_TIMEOUT,
      });
      await expect(roster.getByLabel(member.name)).toBeVisible({
        timeout: ROOM_TIMEOUT,
      });
      await expect(roster.getByLabel("Bia Convidada")).toBeVisible({
        timeout: ROOM_TIMEOUT,
      });

      const participants = await adminClient
        .from("assignment_room_participants")
        .select("display_name,user_id")
        .eq("room_id", roomId);
      const byName = new Map(
        (participants.data ?? []).map((entry) => [entry.display_name, entry.user_id]),
      );
      expect(byName.get(member.name)).toBe(member.id);
      expect(byName.get("Bia Convidada")).toBeNull();

      // A reload must keep the stored invitation usable and must not rotate it.
      await page.reload();
      await waitForRoom(page);
      await page.getByRole("button", { name: "Convidar" }).click();
      await page.getByRole("dialog", { name: "Convide o pessoal" })
        .getByRole("button", { name: "Copiar link" })
        .click();
      expect(await page.evaluate<string>("window.__copiedText ?? ''")).toBe(invitation);
      await page
        .getByRole("dialog", { name: "Convide o pessoal" })
        .getByRole("button", { name: "Voltar para a sala" })
        .click();

      // Register the bill and check the signed-in joiner kept an account share
      // and received an ordinary group invitation.
      await chooseFraction(page, "Itens", "Toast Bacon Egg", "Inteiro").then((dialog) =>
        dialog.getByRole("button", { name: "Confirmar quantidade" }).click(),
      );
      await rowButton(page, "Itens", "Caffe Latte S").click();
      const latte = page.getByRole("dialog", { name: "Caffe Latte S" });
      await latte.getByRole("combobox", { name: "Pra quem?" }).click();
      await page.getByRole("option", { name: member.name, exact: true }).click();
      await latte.getByRole("button", { name: "Inteiro" }).click();
      await latte.getByRole("button", { name: "Confirmar quantidade" }).click();
      await expect(latte).toBeHidden({ timeout: ROOM_TIMEOUT });

      await page.getByRole("button", { name: "Fechar escolhas" }).click();
      await expect(page.getByText("Revise antes de registrar")).toBeVisible({
        timeout: ROOM_TIMEOUT,
      });
      const payerSection = page
        .getByRole("heading", { name: "Quem pagou?" })
        .locator("xpath=ancestor::section");
      await payerSection.getByRole("button").filter({ hasText: host.name }).click();
      await page.getByRole("button", { name: "Registrar conta" }).click();
      await expect(page.getByText("Conta registrada").first()).toBeVisible({
        timeout: 20_000,
      });

      const roomRow = await adminClient
        .from("assignment_rooms")
        .select("expense_id")
        .eq("id", roomId)
        .single();
      const expenseRow = await adminClient
        .from("expenses")
        .select("group_id,current_version_no")
        .eq("id", roomRow.data?.expense_id as string)
        .single();
      const version = await adminClient
        .from("expense_versions")
        .select("payload")
        .eq("expense_id", roomRow.data?.expense_id as string)
        .eq("version_no", expenseRow.data?.current_version_no as number)
        .single();
      const payload = version.data?.payload as {
        participants: Array<{ kind: string; userId?: string }>;
      };
      expect(payload.participants).toEqual(
        expect.arrayContaining([{ kind: "user", userId: member.id }]),
      );
      const membership = await adminClient
        .from("group_members")
        .select("status")
        .eq("group_id", expenseRow.data?.group_id as string)
        .eq("user_id", member.id)
        .single();
      expect(membership.data?.status).toBe("invited");
    } finally {
      await guestContext?.close();
    }
  });

  test("scrolls a long room and keeps the footer reachable", async ({
    browserName,
    context,
    isMobile,
    loginAs,
    page,
    seed,
  }) => {
    // Mobile WebKit has no wheel input at all, so there the browser's own
    // "bring this into view" scroll of the same container is the gesture.
    const supportsWheel = !(browserName === "webkit" && isMobile);
    const host = await seed.createUser({ name: "Ana Rolagem" });
    await recordClipboard(context);
    // Phone projects already run a narrow screen; only the desktop project
    // needs shrinking to the smallest size the app supports.
    const projectViewport = page.viewportSize();
    if ((projectViewport?.width ?? 0) > 420) {
      await page.setViewportSize({ width: 360, height: 740 });
    }
    await loginAs(host, { navigate: false });
    await openRoom(page, longReceipt());

    const scroller = page.locator('[data-testid="room-scroll"]');
    const metrics = await scroller.evaluate((node) => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    // A real scroll of the room, never an assignment to scrollTop.
    if (supportsWheel) {
      await page.mouse.move(180, 400);
      await page.mouse.wheel(0, 600);
    } else {
      await row(page, "Itens", "Item longo número 12").scrollIntoViewIfNeeded();
    }
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollTop), { timeout: ROOM_TIMEOUT })
      .toBeGreaterThan(0);

    const lastRow = row(page, "Itens", "Item longo número 12");
    await lastRow.scrollIntoViewIfNeeded();
    await expect(lastRow).toBeInViewport();
    const footer = page.getByRole("button", { name: "Fechar escolhas" });
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeInViewport();

    // Nothing may leak horizontally on the narrowest supported screen.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Opening and closing both dialogs must leave the room scrollable.
    await page.getByRole("button", { name: "Convidar" }).click();
    await page
      .getByRole("dialog", { name: "Convide o pessoal" })
      .getByRole("button", { name: "Voltar para a sala" })
      .click();
    await rowButton(page, "Itens", "Item longo número 1").click();
    const dialog = page.getByRole("dialog", { name: "Item longo número 1" });
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();

    const after = await scroller.evaluate((node) => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    }));
    expect(after.scrollHeight).toBeGreaterThan(after.clientHeight);
    if (supportsWheel) {
      await page.mouse.wheel(0, 400);
    } else {
      await row(page, "Itens", "Item longo número 12").scrollIntoViewIfNeeded();
    }
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollTop), { timeout: ROOM_TIMEOUT })
      .toBeGreaterThan(0);
  });

  test("splits one item into halves without losing the remainder", async ({
    browser,
    context,
    loginAs,
    page,
    seed,
  }) => {
    const host = await seed.createUser({ name: "Ana Metade" });
    await recordClipboard(context);
    await loginAs(host, { navigate: false });
    const invitation = await openRoom(page, TWO_LINES);

    const guestContext = await browser.newContext(phoneContext(browser, "iPhone 13"));
    const guestPage = await guestContext.newPage();
    try {
      await joinAsGuest(guestPage, invitation, "Bia Metade");

      // Choosing a fraction is a draft. Until it is confirmed the other phone
      // still sees the whole item free.
      const toast = await chooseFraction(page, "Itens", "Toast Bacon Egg", "1/2");
      await expect(
        toast.getByText("Depois de confirmar, restam 1/2 un."),
      ).toBeVisible();
      await expect(
        row(guestPage, "Disponíveis", "Toast Bacon Egg").getByText(
          "Disponível: 1 de 1 un.",
        ),
      ).toBeVisible();

      // Cancelling keeps the room untouched.
      await toast.getByRole("button", { name: "Cancelar" }).click();
      await expect(toast).toBeHidden();
      await expect(
        row(guestPage, "Disponíveis", "Toast Bacon Egg").getByText(
          "Disponível: 1 de 1 un.",
        ),
      ).toBeVisible();

      const confirmed = await chooseFraction(page, "Itens", "Toast Bacon Egg", "1/2");
      await confirmed.getByRole("button", { name: "Confirmar quantidade" }).click();
      await expect(confirmed).toBeHidden({ timeout: ROOM_TIMEOUT });

      // The reported bug: the other half must stay available, on both phones.
      await expect(
        row(page, "Itens", "Toast Bacon Egg").getByText("Disponível: 1/2 de 1 un."),
      ).toBeVisible({ timeout: ROOM_TIMEOUT });
      await expect(
        row(guestPage, "Disponíveis", "Toast Bacon Egg").getByText(
          "Disponível: 1/2 de 1 un.",
        ),
      ).toBeVisible({ timeout: ROOM_TIMEOUT });

      const guestHalf = await chooseFraction(
        guestPage,
        "Disponíveis",
        "Toast Bacon Egg",
        "1/2",
      );
      await guestHalf.getByRole("button", { name: "Confirmar quantidade" }).click();
      await expect(guestHalf).toBeHidden({ timeout: ROOM_TIMEOUT });
      await expect(
        row(page, "Itens", "Toast Bacon Egg").getByText("Tudo escolhido"),
      ).toBeVisible({ timeout: ROOM_TIMEOUT });

      // Releasing the host's half hands it back rather than wiping the guest's.
      await rowButton(page, "Itens", "Toast Bacon Egg").click();
      const release = page.getByRole("dialog", { name: "Toast Bacon Egg" });
      await release.getByRole("button", { name: "Remover minha escolha" }).click();
      await release.getByRole("button", { name: "Confirmar quantidade" }).click();
      await expect(release).toBeHidden({ timeout: ROOM_TIMEOUT });
      await expect(
        row(guestPage, "Minha parte", "Toast Bacon Egg").getByText("Você: 1/2 un."),
      ).toBeVisible({ timeout: ROOM_TIMEOUT });
      await expect(
        row(guestPage, "Disponíveis", "Toast Bacon Egg").getByText(
          "Disponível: 1/2 de 1 un.",
        ),
      ).toBeVisible({ timeout: ROOM_TIMEOUT });
    } finally {
      await guestContext.close();
    }
  });

  test("keeps a third exact and refuses a colliding claim", async ({
    browser,
    context,
    loginAs,
    page,
    seed,
  }) => {
    const host = await seed.createUser({ name: "Ana Terço" });
    await recordClipboard(context);
    await loginAs(host, { navigate: false });
    const invitation = await openRoom(page, TWO_LINES);

    const guestContext = await browser.newContext(phoneContext(browser, "iPhone 13"));
    const guestPage = await guestContext.newPage();
    try {
      await joinAsGuest(guestPage, invitation, "Bia Terço");

      const third = await chooseFraction(page, "Itens", "Caffe Latte S", "1/3");
      await expect(third.getByText("Sua quantidade: 1/3 un.")).toBeVisible();
      await third.getByRole("button", { name: "Confirmar quantidade" }).click();
      await expect(third).toBeHidden({ timeout: ROOM_TIMEOUT });

      // A third of one item reads as a third, never as 0,333 or raw ticks.
      await expect(
        row(page, "Itens", "Caffe Latte S").getByText("Disponível: 2/3 de 1 un."),
      ).toBeVisible({ timeout: ROOM_TIMEOUT });

      // The guest asks for more than is left and is told so, keeping the draft.
      await rowButton(guestPage, "Disponíveis", "Caffe Latte S").click();
      const guestDialog = guestPage.getByRole("dialog", { name: "Caffe Latte S" });
      await guestDialog.getByRole("button", { name: "Outra quantidade" }).click();
      await guestDialog
        .getByRole("textbox", { name: "Quantidade desejada" })
        .fill("1");
      await expect(guestDialog.getByRole("alert")).toContainText(
        "não está mais disponível",
      );
      await expect(
        guestDialog.getByRole("button", { name: "Confirmar quantidade" }),
      ).toBeDisabled();

      await guestDialog.getByRole("button", { name: "Pegar o restante" }).click();
      await guestDialog.getByRole("button", { name: "Confirmar quantidade" }).click();
      await expect(guestDialog).toBeHidden({ timeout: ROOM_TIMEOUT });
      await expect(
        row(page, "Itens", "Caffe Latte S").getByText("Tudo escolhido"),
      ).toBeVisible({ timeout: ROOM_TIMEOUT });
    } finally {
      await guestContext.close();
    }
  });
});
