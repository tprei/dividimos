import { devices } from "@playwright/test";
import type { Browser, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const ROOM_TIMEOUT = 5_000;
const HOST_NAME = "Ana Sala";
const GUEST_A = "Bia";
const GUEST_B = "Caio";

// Board rows live in named lists, so every helper scopes to the list plus the
// item row instead of relying on DOM order.
type RoomList = "Itens" | "Disponíveis" | "Minha parte";

function itemCard(page: Page, list: RoomList, description: string): Locator {
  return page
    .getByRole("region", { name: list })
    .locator("li[data-item-id]")
    .filter({ has: page.getByText(description, { exact: true }) });
}

function rowButton(page: Page, list: RoomList, description: string): Locator {
  return itemCard(page, list, description).getByRole("button", {
    name: new RegExp(`(Escolher quantidade de|Editar escolhas de) ${description}`),
  });
}

async function waitForRoom(page: Page): Promise<void> {
  // Creating a room opens the invitation over the board, and a modal takes the
  // background out of the accessibility tree, so this waits on text.
  await page.waitForURL(/\/room\/[0-9a-f-]{36}/i, { timeout: 20_000 });
  await expect(page.getByText("Bar da sala").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Reconectando.", { exact: false })).toBeHidden({
    timeout: 20_000,
  });
}

async function claimQuantity(
  page: Page,
  list: RoomList,
  description: string,
  quantity: string,
): Promise<void> {
  await rowButton(page, list, description).click();
  const dialog = page.getByRole("dialog", { name: description });
  await dialog.getByRole("button", { name: "Outra quantidade" }).click();
  await dialog.getByRole("textbox", { name: "Quantidade desejada" }).fill(quantity);
  await dialog.getByRole("button", { name: "Confirmar quantidade" }).click();
  await expect(dialog).toBeHidden({ timeout: ROOM_TIMEOUT });
}

async function claimOneThird(
  page: Page,
  list: RoomList,
  description: string,
): Promise<void> {
  await rowButton(page, list, description).click();
  const dialog = page.getByRole("dialog", { name: description });
  await dialog.getByRole("button", { name: "1/3", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirmar quantidade" }).click();
  await expect(dialog).toBeHidden({ timeout: ROOM_TIMEOUT });
}

// A production build copies the canonical production origin, so guests join
// through the same path and fragment on the server under test.
function localInvitation(invitation: string): string {
  const url = new URL(invitation);
  return `${url.pathname}${url.hash}`;
}

async function joinRoom(page: Page, invitation: string, displayName: string): Promise<void> {
  await page.goto(localInvitation(invitation));
  await page.getByRole("textbox", { name: "Seu nome" }).fill(displayName);
  await page.getByRole("button", { name: "Entrar na sala" }).click();
  await waitForRoom(page);
}

async function observeRemote(
  testInfo: TestInfo,
  label: string,
  action: () => Promise<void>,
  remoteAssertion: () => Promise<void>,
): Promise<void> {
  const startedAt = performance.now();
  await action();
  await remoteAssertion();
  testInfo.annotations.push({
    type: "room-latency",
    description: `${label}: ${Math.round(performance.now() - startedAt)}ms`,
  });
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

test.describe("Assignment room multi-client acceptance", () => {
  test.setTimeout(600_000);
  test("feels like everyone's using the same client", async ({
    adminClient,
    browser,
    context,
    isMobile,
    loginAs,
    page,
    seed,
  }, testInfo) => {
    const host = await seed.createUser({ name: HOST_NAME });
    let guestAContext: BrowserContext | null = null;
    let guestBContext: BrowserContext | null = null;

    // WebKit rejects the clipboard permissions Chromium grants, so record what
    // the app copies instead of reading the real clipboard.
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
    await page.route("**/api/receipt/ocr", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          merchant: "Bar da sala",
          items: [
            {
              description: "Cervejas",
              quantity: 3,
              unitPriceCents: 2_000,
              totalCents: 6_000,
            },
            {
              description: "Petisco",
              quantity: 3,
              unitPriceCents: 1_000,
              totalCents: 3_000,
            },
            {
              description: "Última cerveja",
              quantity: 1,
              unitPriceCents: 1_000,
              totalCents: 1_000,
            },
          ],
          serviceFeeBasisPoints: 1_000,
          fixedFeesCents: 1,
          totalCents: 11_001,
        }),
      });
    });

    try {
      await loginAs(host, { navigate: false });
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
      const createRoom = page.getByRole("button", { name: "Criar sala de divisão" });
      await expect(createRoom).toBeEnabled();
      await createRoom.click();
      await waitForRoom(page);

      const roomId = new URL(page.url()).pathname.split("/").at(-1);
      expect(roomId).toMatch(/^[0-9a-f-]{36}$/i);
      // Creating the room presents the invitation on arrival; the header
      // trigger keeps it reachable without scrolling.
      const inviteDialog = page.getByRole("dialog", { name: "Convide o pessoal" });
      await expect(inviteDialog).toBeVisible();
      await inviteDialog.getByRole("button", { name: "Copiar link" }).click();
      await expect(inviteDialog.getByRole("button", { name: "Link copiado" })).toBeVisible();
      const invitation = await page.evaluate<string>(
        "window.__copiedText ?? ''",
      );
      expect(invitation).toMatch(new RegExp(`/room/${roomId}#armj1_`));
      await inviteDialog.getByRole("button", { name: "Voltar para a sala" }).click();
      await expect(inviteDialog).toBeHidden();
      await expect(page.getByRole("button", { name: "Convidar" })).toBeVisible();
      await expect(page.getByText("1 pessoa na sala")).toBeVisible();

      // The people who scan the QR are on phones, so the joiners run on the
      // real iPhone and Pixel descriptors instead of an invented viewport.
      guestAContext = await browser.newContext({
        ...phoneContext(browser, "iPhone 13"),
        colorScheme: "light",
      });
      guestBContext = await browser.newContext({
        ...phoneContext(browser, "Pixel 5"),
        colorScheme: "dark",
      });
      const guestAPage = await guestAContext.newPage();
      const guestBPage = await guestBContext.newPage();
      await joinRoom(guestAPage, invitation, GUEST_A);
      await expect(
        page.getByRole("region", { name: "Na sala" }).getByLabel(GUEST_A),
      ).toBeVisible({ timeout: ROOM_TIMEOUT });
      await joinRoom(guestBPage, invitation, GUEST_B);

      for (const roomPage of [page, guestAPage, guestBPage]) {
        const roster = roomPage.getByRole("region", { name: "Na sala" });
        await expect(roster.getByText("3 pessoas na sala")).toBeVisible({
          timeout: ROOM_TIMEOUT,
        });
        await expect(roster.getByLabel(HOST_NAME)).toBeVisible({
          timeout: ROOM_TIMEOUT,
        });
        await expect(roster.getByLabel(GUEST_A)).toBeVisible({
          timeout: ROOM_TIMEOUT,
        });
        await expect(roster.getByLabel(GUEST_B)).toBeVisible({
          timeout: ROOM_TIMEOUT,
        });
      }

      await test.step("feels like everyone's using the same client", async () => {
        await observeRemote(
          testInfo,
          "claim",
          async () => {
            await claimQuantity(guestAPage, "Disponíveis", "Cervejas", "2");
            await expect(
              itemCard(guestAPage, "Minha parte", "Cervejas").getByText("Você: 2 un."),
            ).toBeVisible();
          },
          async () => {
            await expect(
              itemCard(page, "Itens", "Cervejas").getByText("Disponível: 1 de 3 un."),
            ).toBeVisible({ timeout: ROOM_TIMEOUT });
            // Asking for more than the room still holds is refused before any
            // request leaves the phone, and the draft stays put.
            const remoteDialog = guestBPage.getByRole("dialog", { name: "Cervejas" });
            await rowButton(guestBPage, "Disponíveis", "Cervejas").click();
            await remoteDialog.getByRole("button", { name: "Outra quantidade" }).click();
            await remoteDialog.getByRole("textbox", { name: "Quantidade desejada" }).fill("2");
            await expect(remoteDialog.getByRole("alert")).toContainText(
              "não está mais disponível",
            );
            await expect(
              remoteDialog.getByRole("button", { name: "Confirmar quantidade" }),
            ).toBeDisabled();
            await remoteDialog.getByRole("button", { name: "Cancelar" }).click();
          },
        );

        await claimQuantity(guestBPage, "Disponíveis", "Cervejas", "1");
        await expect(
          itemCard(page, "Itens", "Cervejas").getByText("Tudo escolhido"),
        ).toBeVisible({ timeout: ROOM_TIMEOUT });

        await observeRemote(
          testInfo,
          "undo",
          () => claimQuantity(guestAPage, "Minha parte", "Cervejas", "1"),
          async () => {
            await expect(
              itemCard(page, "Itens", "Cervejas").getByText("Disponível: 1 de 3 un."),
            ).toBeVisible({ timeout: ROOM_TIMEOUT });
          },
        );

        const guestBPetisco = itemCard(guestBPage, "Disponíveis", "Petisco");
        await guestBPetisco
          .getByRole("button", { name: "Escolher quantidade de Petisco" })
          .click();
        const petiscoDialog = guestBPage.getByRole("dialog", { name: "Petisco" });
        await petiscoDialog.getByRole("button", { name: "Outra quantidade" }).click();
        const preservedInput = petiscoDialog.getByRole("textbox", {
          name: "Quantidade desejada",
        });
        // A claim landing elsewhere in the room must not throw away what this
        // person is typing, and must not submit it either.
        await preservedInput.fill("2");
        await claimQuantity(page, "Itens", "Cervejas", "1");
        await expect(preservedInput).toBeVisible({ timeout: ROOM_TIMEOUT });
        await expect(preservedInput).toHaveValue("2");
        await expect(petiscoDialog.getByText("Escolha uma quantidade")).toBeHidden();
        await preservedInput.fill("1");
        await petiscoDialog.getByRole("button", { name: "Confirmar quantidade" }).click();
        await expect(
          itemCard(guestBPage, "Minha parte", "Petisco").getByText("Você: 1 un."),
        ).toBeVisible({ timeout: ROOM_TIMEOUT });

        await itemCard(guestBPage, "Minha parte", "Petisco")
          .getByRole("button", { name: "Escolher quantidade de Petisco" })
          .click();
        await expect(petiscoDialog.getByText("Sua quantidade: 1 un.")).toBeVisible();
        await petiscoDialog.getByRole("button", { name: "Outra quantidade" }).click();
        await preservedInput.fill("2");
        await guestBPage.keyboard.press("Escape");
        await expect(petiscoDialog).toBeHidden();
        const reopenPetisco = itemCard(guestBPage, "Minha parte", "Petisco").getByRole(
          "button",
          { name: "Escolher quantidade de Petisco" },
        );
        // Dismissing the editor hands focus back to the row that opened it.
        // Touch profiles deliberately skip that, so a focus ring never appears
        // after a tap; there the row only has to be reachable again.
        if (isMobile) {
          await expect(reopenPetisco).toBeVisible();
        } else {
          await expect(reopenPetisco).toBeFocused();
        }
        await reopenPetisco.click();
        await expect(
          petiscoDialog.getByText("Sua quantidade: 1 un."),
        ).toBeVisible({ timeout: ROOM_TIMEOUT });
        await petiscoDialog.getByRole("button", { name: "Cancelar" }).click();

        // Caio already holds one of the three, so the host's third leaves one.
        await claimOneThird(page, "Itens", "Petisco");
        await expect(
          itemCard(page, "Itens", "Petisco").getByText("Disponível: 1 de 3 un."),
        ).toBeVisible({ timeout: ROOM_TIMEOUT });
      });
      await expect
        .poll(() =>
          guestAPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        )
        .toBe(true);
      expect(
        await guestBPage.evaluate(() => window.matchMedia("(prefers-color-scheme: dark)").matches),
      ).toBe(true);
      await guestBPage.getByRole("button", { name: "Voltar" }).click();
      await expect(guestBPage).not.toHaveURL(/\/room\//, { timeout: ROOM_TIMEOUT });
      await guestBPage.goto(new URL(invitation).pathname);
      await waitForRoom(guestBPage);
      await expect(
        itemCard(guestBPage, "Minha parte", "Petisco").getByText("Você: 1 un."),
      ).toBeVisible();

      // Caio lines up the last unit while Bia takes it first. Only one claim
      // may land, and Caio must be told rather than silently overwriting it.
      const finalDialogB = guestBPage.getByRole("dialog", { name: "Última cerveja" });
      await rowButton(guestBPage, "Disponíveis", "Última cerveja").click();
      await finalDialogB.getByRole("button", { name: "Outra quantidade" }).click();
      await finalDialogB.getByRole("textbox", { name: "Quantidade desejada" }).fill("1");

      await claimQuantity(guestAPage, "Disponíveis", "Última cerveja", "1");

      const confirmB = finalDialogB.getByRole("button", { name: "Confirmar quantidade" });
      if (await confirmB.isEnabled()) {
        await confirmB.click();
      }
      await expect(finalDialogB.getByRole("alert")).toContainText(
        "não está mais disponível",
        { timeout: ROOM_TIMEOUT },
      );
      const lastBeerId = (
        await adminClient
          .from("assignment_room_items")
          .select("id")
          .eq("room_id", roomId as string)
          .eq("description", "Última cerveja")
          .single()
      ).data?.id as string;
      const lastBeerClaims = await adminClient
        .from("assignment_room_claims")
        .select("participant_id")
        .eq("room_id", roomId as string)
        .eq("item_id", lastBeerId);
      expect(lastBeerClaims.data ?? []).toHaveLength(1);
      await guestBPage.keyboard.press("Escape");
      await expect(finalDialogB).toBeHidden({ timeout: ROOM_TIMEOUT });

      await guestBContext.setOffline(true);
      await page.getByText("Gerenciar pessoas").click();
      await page.getByRole("button", { name: `Remover ${GUEST_A}` }).click();
      await page.getByRole("button", { name: "Remover e liberar itens" }).click();
      await expect(page.getByText("Removido", { exact: true })).toBeVisible({
        timeout: ROOM_TIMEOUT,
      });
      const removedState = guestAPage.getByRole("heading", {
        name: "Convite inválido ou acesso expirado",
      });
      if (!(await removedState.isVisible({ timeout: ROOM_TIMEOUT }))) {
        await claimQuantity(guestAPage, "Minha parte", "Cervejas", "1");
      }
      await expect(removedState).toBeVisible({ timeout: ROOM_TIMEOUT });
      await expect(page.getByRole("button", { name: "Fechar escolhas" })).toBeDisabled();

      const reconnectStartedAt = performance.now();
      await guestBContext.setOffline(false);
      await waitForRoom(guestBPage);
      testInfo.annotations.push({
        type: "room-reconnect",
        description: `topic rotation recovery: ${Math.round(performance.now() - reconnectStartedAt)}ms; transport: Supabase private broadcast`,
      });
      const backgroundTab = await guestBContext.newPage();
      await backgroundTab.bringToFront();
      await guestBPage.bringToFront();
      await backgroundTab.close();
      await waitForRoom(guestBPage);
      await expect(
        itemCard(guestBPage, "Minha parte", "Petisco").getByText("Você: 1 un."),
      ).toBeVisible();

      await claimQuantity(page, "Itens", "Cervejas", "2");
      await claimQuantity(page, "Itens", "Petisco", "2");

      // A claim is always self-made, so Caio releases his beer from his own
      // phone, and he can only do it while the room is still open.
      const guestBBeerDialog = guestBPage.getByRole("dialog", { name: "Cervejas" });
      const releaseBeer = rowButton(guestBPage, "Minha parte", "Cervejas");
      await expect(releaseBeer).toBeEnabled({ timeout: ROOM_TIMEOUT });
      await releaseBeer.click();
      await guestBBeerDialog.getByRole("button", { name: /^Remover (minha escolha|escolha de)/ }).click();
      await guestBBeerDialog.getByRole("button", { name: "Confirmar quantidade" }).click();
      await expect(guestBBeerDialog).toBeHidden({ timeout: ROOM_TIMEOUT });
      await expect(
        itemCard(guestBPage, "Disponíveis", "Cervejas").getByText("Disponível: 1 de 3 un."),
      ).toBeVisible({ timeout: ROOM_TIMEOUT });
      // The freed unit reaches the host only by sync, and claiming three fails
      // while the host board still shows nothing available.
      await expect(
        itemCard(page, "Itens", "Cervejas").getByText("Disponível: 1 de 3 un."),
      ).toBeVisible({ timeout: ROOM_TIMEOUT });
      await claimQuantity(page, "Itens", "Cervejas", "3");
      await expect(itemCard(guestBPage, "Disponíveis", "Cervejas")).toHaveCount(0);

      const closeChoices = page.getByRole("button", { name: "Fechar escolhas" });
      if (!(await closeChoices.isEnabled())) {
        await claimQuantity(page, "Itens", "Última cerveja", "1");
      }
      await expect(closeChoices).toBeEnabled({ timeout: ROOM_TIMEOUT });
      await observeRemote(
        testInfo,
        "close",
        () => page.getByRole("button", { name: "Fechar escolhas" }).click(),
        async () => {
          await expect(guestBPage.getByText("Aguardando confirmação")).toBeVisible({
            timeout: ROOM_TIMEOUT,
          });
          await expect(
            itemCard(guestBPage, "Minha parte", "Petisco").getByRole("button", {
              name: "Escolher quantidade de Petisco",
            }),
          ).toBeDisabled();
        },
      );

      // The host reviews what the room produced; correcting somebody else's
      // line is no longer possible, so this only walks back to the review.
      await page.getByRole("button", { name: "Corrigir escolhas" }).click();
      await page.getByRole("button", { name: "Voltar", exact: true }).click();
      await expect(page.getByText("Revise antes de registrar")).toBeVisible();
      const payerSection = page
        .getByRole("heading", { name: "Quem pagou?" })
        .locator("xpath=ancestor::section");
      await payerSection.getByRole("button").filter({ hasText: HOST_NAME }).click();

      let droppedFinalizeResponse = false;
      await page.route("**/rest/v1/rpc/finalize_assignment_room", async (route) => {
        if (droppedFinalizeResponse) {
          await route.continue();
          return;
        }
        droppedFinalizeResponse = true;
        const response = await route.fetch();
        await response.body();
        await route.abort("connectionfailed");
      });
      await page.getByRole("button", { name: "Registrar conta" }).click();
      const retry = page.getByRole("button", { name: "Registrar conta" });
      if (await retry.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expect(retry).toBeEnabled({ timeout: ROOM_TIMEOUT });
        await retry.click();
      }
      await expect(page.getByText("Conta registrada").first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(guestBPage.getByText("Conta registrada").first()).toBeVisible({
        timeout: ROOM_TIMEOUT,
      });
      expect(droppedFinalizeResponse).toBe(true);

      const roomRow = await adminClient
        .from("assignment_rooms")
        .select("expense_id,status")
        .eq("id", roomId as string)
        .single();
      expect(roomRow.data?.status).toBe("finalized");
      const expenseId = roomRow.data?.expense_id as string;
      const expenseRow = await adminClient
        .from("expenses")
        .select("group_id,current_version_no,status")
        .eq("id", expenseId)
        .single();
      expect(expenseRow.data?.status).toBe("active");
      const versionRow = await adminClient
        .from("expense_versions")
        .select("occurred_on,title,merchant_name,expense_type,total_cents,service_fee_bps,fixed_fee_cents,payload")
        .eq("expense_id", expenseId)
        .eq("version_no", expenseRow.data?.current_version_no as number)
        .single();
      expect(versionRow.data).toMatchObject({
        total_cents: 11_001,
        service_fee_bps: 1_000,
        fixed_fee_cents: 1,
      });
      const payload = versionRow.data?.payload as {
        items: Array<{ description: string; totalPriceCents: number }>;
        shares: number[];
        payers: Array<{ amountCents: number }>;
      };
      expect(payload.items.reduce((sum, item) => sum + item.totalPriceCents, 0)).toBe(10_000);
      expect(payload.shares.reduce((sum, cents) => sum + cents, 0)).toBe(11_001);
      expect(payload.payers.reduce((sum, payer) => sum + payer.amountCents, 0)).toBe(11_001);

      const balances = await adminClient
        .from("group_balances")
        .select("net_cents")
        .eq("group_id", expenseRow.data?.group_id as string);
      expect((balances.data ?? []).reduce((sum, row) => sum + Number(row.net_cents), 0)).toBe(0);

      const editedPayload = {
        ...payload,
        items: payload.items.map((item, index) =>
          index === 0 ? { ...item, description: "Cervejas geladas" } : item,
        ),
      };
      const hostClient = await seed.authenticateAs(host.id);
      await observeRemote(
        testInfo,
        "edit",
        async () => {
          const { error } = await hostClient.rpc("edit_expense", {
            p_expense_id: expenseId,
            p_expected_version_no: expenseRow.data?.current_version_no as number,
            p_occurred_on: versionRow.data?.occurred_on as string,
            p_title: versionRow.data?.title as string,
            p_merchant_name: versionRow.data?.merchant_name,
            p_expense_type: versionRow.data?.expense_type,
            p_total_cents: versionRow.data?.total_cents as number,
            p_service_fee_bps: versionRow.data?.service_fee_bps as number,
            p_fixed_fee_cents: versionRow.data?.fixed_fee_cents as number,
            p_payload: editedPayload,
          });
          expect(error).toBeNull();
        },
        async () => {
          for (const surface of [page, guestBPage]) {
            const ownRow = surface.getByRole("button", { name: /Ana Sala/ });
            if ((await ownRow.getAttribute("aria-expanded")) === "false") {
              await ownRow.click();
            }
            await expect(
              surface.getByLabel("Por pessoa").getByText("Cervejas geladas", { exact: true }),
            ).toBeVisible({
              timeout: ROOM_TIMEOUT,
            });
          }
        },
      );

      await testInfo.attach("assignment-room-final", {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    } finally {
      await Promise.allSettled([
        guestAContext?.close() ?? Promise.resolve(),
        guestBContext?.close() ?? Promise.resolve(),
      ]);
    }
  });
});
