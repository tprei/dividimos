import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const ROOM_TIMEOUT = 5_000;
const HOST_NAME = "Ana Sala";
const GUEST_A = "Bia";
const GUEST_B = "Caio";

function itemCard(page: Page, description: string): Locator {
  return page
    .getByRole("heading", { name: description, exact: true })
    .locator("xpath=ancestor::article");
}

async function waitForRoom(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Bar da sala" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Reconectando.", { exact: false })).toBeHidden({
    timeout: 20_000,
  });
}

async function claimQuantity(
  page: Page,
  description: string,
  quantity: string,
): Promise<void> {
  const card = itemCard(page, description);
  const input = card.getByRole("textbox", { name: "Quantidade desejada" });
  if (!(await input.isVisible())) {
    await card.getByRole("button", { name: /Escolher quantidade|Editar minha parte/ }).click();
  }
  await input.fill(quantity);
  await card.getByRole("button", { name: "Confirmar quantidade" }).click();
  await expect(card.getByText("Salvando sua escolha...")).toBeHidden({ timeout: ROOM_TIMEOUT });
}

async function claimOneThird(page: Page, description: string): Promise<void> {
  const card = itemCard(page, description);
  const fraction = card.getByRole("button", { name: "1/3", exact: true });
  if (!(await fraction.isVisible())) {
    await card.getByRole("button", { name: /Escolher quantidade|Editar minha parte/ }).click();
  }
  await fraction.click();
  await expect(card.getByText("Salvando sua escolha...")).toBeHidden({ timeout: ROOM_TIMEOUT });
}

async function collapseEditor(page: Page, description: string): Promise<void> {
  const card = itemCard(page, description);
  const collapse = card.getByRole("button", { name: "Recolher" });
  if (await collapse.isVisible()) await collapse.click();
}

async function joinRoom(page: Page, invitation: string, displayName: string): Promise<void> {
  await page.goto(invitation);
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

test.describe("Assignment room multi-client acceptance", () => {
  test.setTimeout(180_000);
  test("feels like everyone's using the same client", async ({
    adminClient,
    browser,
    context,
    loginAs,
    page,
    seed,
  }, testInfo) => {
    const host = await seed.createUser({ name: HOST_NAME });
    let guestAContext: BrowserContext | null = null;
    let guestBContext: BrowserContext | null = null;

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
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
      const shareReceipt = page.getByRole("button", {
        name: "Compartilhar para escolher itens",
      });
      await expect(shareReceipt).toBeEnabled();
      await shareReceipt.click();
      await waitForRoom(page);

      const roomId = new URL(page.url()).pathname.split("/").at(-1);
      expect(roomId).toMatch(/^[0-9a-f-]{36}$/i);
      await page.getByRole("button", { name: "Mostrar convite" }).click();
      await page.getByRole("button", { name: "Copiar link" }).click();
      await expect(page.getByRole("button", { name: "Link copiado" })).toBeVisible();
      const invitation = await page.evaluate<string>("navigator.clipboard.readText()");
      expect(invitation).toMatch(new RegExp(`/room/${roomId}#armj1_`));
      await page.getByRole("button", { name: "Recolher convite" }).click();

      guestAContext = await browser.newContext({
        colorScheme: "light",
        viewport: { width: 390, height: 844 },
      });
      guestBContext = await browser.newContext({
        colorScheme: "dark",
        viewport: { width: 1280, height: 720 },
      });
      const guestAPage = await guestAContext.newPage();
      const guestBPage = await guestBContext.newPage();
      await joinRoom(guestAPage, invitation, GUEST_A);
      const hostRoster = page
        .getByRole("heading", { name: "Na sala" })
        .locator("xpath=ancestor::section");
      await expect(hostRoster.getByText(GUEST_A, { exact: true })).toBeVisible({
        timeout: ROOM_TIMEOUT,
      });
      await joinRoom(guestBPage, invitation, GUEST_B);

      for (const roomPage of [page, guestAPage, guestBPage]) {
        const roster = roomPage
          .getByRole("heading", { name: "Na sala" })
          .locator("xpath=ancestor::section");
        await expect(roster.getByText(HOST_NAME, { exact: true })).toBeVisible({
          timeout: ROOM_TIMEOUT,
        });
        await expect(roster.getByText(GUEST_A, { exact: true })).toBeVisible({
          timeout: ROOM_TIMEOUT,
        });
        await expect(roster.getByText(GUEST_B, { exact: true })).toBeVisible({
          timeout: ROOM_TIMEOUT,
        });
      }

      await test.step("feels like everyone's using the same client", async () => {
        await observeRemote(
          testInfo,
          "claim",
          async () => {
            await claimQuantity(guestAPage, "Cervejas", "2");
            await expect(itemCard(guestAPage, "Cervejas").getByText("2/3 do item")).toBeVisible();
          },
          async () => {
            await page.getByLabel("Editar escolhas de").selectOption({ label: GUEST_A });
            await expect(itemCard(page, "Cervejas").getByText("2/3 do item")).toBeVisible({
              timeout: ROOM_TIMEOUT,
            });
            const remoteCard = itemCard(guestBPage, "Cervejas");
            await remoteCard.getByRole("button", { name: "Escolher quantidade" }).click();
            await remoteCard.getByRole("textbox", { name: "Quantidade desejada" }).fill("2");
            await remoteCard.getByRole("button", { name: "Confirmar quantidade" }).click();
            await expect(remoteCard.getByRole("alert")).toContainText("não está mais disponível");
            await remoteCard.getByRole("button", { name: "Recolher" }).click();
          },
        );

        await claimQuantity(guestBPage, "Cervejas", "1");
        await page.getByLabel("Editar escolhas de").selectOption({ label: GUEST_B });
        await expect(itemCard(page, "Cervejas").getByText("1/3 do item")).toBeVisible({
          timeout: ROOM_TIMEOUT,
        });

        await observeRemote(
          testInfo,
          "undo",
          () => claimQuantity(guestAPage, "Cervejas", "1"),
          async () => {
            await page.getByLabel("Editar escolhas de").selectOption({ label: GUEST_A });
            await expect(itemCard(page, "Cervejas").getByText("1/3 do item")).toBeVisible({
              timeout: ROOM_TIMEOUT,
            });
          },
        );

        const guestBPetisco = itemCard(guestBPage, "Petisco");
        await guestBPetisco.getByRole("button", { name: "Escolher quantidade" }).click();
        const preservedInput = guestBPetisco.getByRole("textbox", {
          name: "Quantidade desejada",
        });
        await preservedInput.focus();
        await page.getByLabel("Editar escolhas de").selectOption({ label: HOST_NAME });
        await claimQuantity(page, "Cervejas", "1");
        await expect(preservedInput).toBeVisible({ timeout: ROOM_TIMEOUT });
        await expect(preservedInput).toBeFocused();
        await preservedInput.fill("1");
        await guestBPetisco.getByRole("button", { name: "Confirmar quantidade" }).click();
        await expect(guestBPetisco.getByText("1/3 do item")).toBeVisible({ timeout: ROOM_TIMEOUT });
        await preservedInput.fill("2");
        await guestBPage.keyboard.press("Escape");
        await expect(preservedInput).toBeHidden();
        const reopenPetisco = guestBPetisco.getByRole("button", {
          name: "Editar minha parte",
        });
        await expect(reopenPetisco).toBeFocused();
        await reopenPetisco.click();
        await expect(preservedInput).toHaveValue("1");
        await collapseEditor(guestBPage, "Petisco");

        await claimOneThird(page, "Petisco");
        await expect(itemCard(page, "Petisco").getByText("1/3 do item")).toBeVisible();
        await collapseEditor(page, "Petisco");
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
      await guestBPage.goto(invitation.split("#")[0]);
      await waitForRoom(guestBPage);
      await expect(itemCard(guestBPage, "Petisco").getByText("1/3 do item")).toBeVisible();

      const finalBeerA = itemCard(guestAPage, "Última cerveja");
      const finalBeerB = itemCard(guestBPage, "Última cerveja");
      await finalBeerA.getByRole("button", { name: "Escolher quantidade" }).click();
      await finalBeerB.getByRole("button", { name: "Escolher quantidade" }).click();
      await finalBeerA.getByRole("textbox", { name: "Quantidade desejada" }).fill("1");
      await finalBeerB.getByRole("textbox", { name: "Quantidade desejada" }).fill("1");
      await Promise.all([
        finalBeerA.getByRole("button", { name: "Confirmar quantidade" }).click(),
        finalBeerB.getByRole("button", { name: "Confirmar quantidade" }).click(),
      ]);
      await expect
        .poll(
          async () => {
            const { data } = await adminClient
              .from("assignment_room_claims")
              .select("participant_id")
              .eq("room_id", roomId as string)
              .eq("item_id", (
                await adminClient
                  .from("assignment_room_items")
                  .select("id")
                  .eq("room_id", roomId as string)
                  .eq("description", "Última cerveja")
                  .single()
              ).data?.id ?? "");
            return data?.length ?? 0;
          },
          { timeout: ROOM_TIMEOUT },
        )
        .toBe(1);
      await expect
        .poll(
          async () =>
            (await finalBeerA.getByRole("alert").count()) +
            (await finalBeerB.getByRole("alert").count()),
          { timeout: ROOM_TIMEOUT },
        )
        .toBe(1);

      await guestBContext.setOffline(true);
      await page.getByRole("button", { name: `Remover ${GUEST_A}` }).click();
      await page.getByRole("button", { name: "Remover e liberar itens" }).click();
      await expect(page.getByText("Removido", { exact: true })).toBeVisible({
        timeout: ROOM_TIMEOUT,
      });
      const removedState = guestAPage.getByRole("heading", {
        name: "Convite inválido ou acesso expirado",
      });
      if (!(await removedState.isVisible({ timeout: ROOM_TIMEOUT }))) {
        await claimQuantity(guestAPage, "Cervejas", "1");
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
      await expect(itemCard(guestBPage, "Petisco").getByText("1/3 do item")).toBeVisible();

      await page.getByLabel("Editar escolhas de").selectOption({ label: HOST_NAME });
      await claimQuantity(page, "Cervejas", "2");
      await collapseEditor(page, "Cervejas");
      await claimQuantity(page, "Petisco", "2");
      await collapseEditor(page, "Petisco");
      const closeChoices = page.getByRole("button", { name: "Fechar escolhas" });
      if (!(await closeChoices.isEnabled())) {
        await claimQuantity(page, "Última cerveja", "1");
        await collapseEditor(page, "Última cerveja");
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
            itemCard(guestBPage, "Cervejas").getByRole("button", {
              name: /Escolher quantidade|Editar minha parte|Confirmar quantidade/,
            }),
          ).toBeDisabled();
        },
      );

      await page.getByRole("button", { name: "Corrigir escolhas" }).click();
      await page.getByLabel("Editar escolhas de").selectOption({ label: GUEST_B });
      const guestBBeer = itemCard(page, "Cervejas");
      if (!(await guestBBeer.getByRole("button", { name: "Desfazer minha escolha" }).isVisible())) {
        await guestBBeer.getByRole("button", { name: "Editar minha parte" }).click();
      }
      await guestBBeer.getByRole("button", { name: "Desfazer minha escolha" }).click();
      await expect(itemCard(guestBPage, "Cervejas").getByText("Nada escolhido")).toBeVisible({
        timeout: ROOM_TIMEOUT,
      });
      await page.getByLabel("Editar escolhas de").selectOption({ label: HOST_NAME });
      await claimQuantity(page, "Cervejas", "3");
      await expect(itemCard(guestBPage, "Cervejas")).toHaveCount(0);
      await page.getByRole("button", { name: "Voltar" }).click();
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
          await expect(page.getByText("Cervejas geladas", { exact: true })).toBeVisible({
            timeout: ROOM_TIMEOUT,
          });
          await expect(guestBPage.getByText("Cervejas geladas", { exact: true })).toBeVisible({
            timeout: ROOM_TIMEOUT,
          });
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
