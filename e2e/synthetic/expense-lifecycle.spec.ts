import { test, expect } from "../fixtures";

/**
 * Expense Lifecycle Synthetic Test
 *
 * Two seeded users in a group. The creator builds a draft expense,
 * activates it, the other user views debts, then the debtor settles
 * through the group settlement view. Verifies UI state transitions
 * (draft → active → settled) and balance updates throughout.
 */

test.describe("Expense Lifecycle", () => {
  test("draft → active → settled with two users", async ({
    page,
    seed,
    loginAs,
    browser,
  }) => {
    // ---------------------------------------------------------------
    // Seed: two users + group
    // ---------------------------------------------------------------
    const alice = await seed.createUser({ name: "Alice Lifecycle" });
    const bob = await seed.createUser({ name: "Bob Lifecycle" });
    const group = await seed.createGroup(alice.id, [bob.id], "Lifecycle Test");

    // ---------------------------------------------------------------
    // 1. Alice creates an active expense via seed (draft + activate)
    // ---------------------------------------------------------------
    const expense = await seed.createActiveExpense(
      group.id,
      alice.id,
      [alice.id, bob.id],
      {
        title: "Jantar Lifecycle",
        totalAmount: 10000, // R$100,00
        expenseType: "single_amount",
      },
    );

    // ---------------------------------------------------------------
    // 2. Alice views the active expense — sees "Ativo" badge
    // ---------------------------------------------------------------
    await loginAs(alice);
    await page.goto(`/app/bill/${expense.id}`);
    await page.waitForLoadState("networkidle");

    // Title visible
    await expect(page.getByText("Jantar Lifecycle")).toBeVisible();

    // Status badge: "Ativo" (active)
    await expect(page.getByText("Ativo")).toBeVisible();

    // Total amount visible (R$ 100,00)
    await expect(page.getByText("R$ 100,00")).toBeVisible();

    // Payment tab shows debt info — alice paid, so bob owes alice
    const paymentTab = page.getByRole("button", { name: /Pagamento/i });
    await paymentTab.click();

    // Bob owes alice: "Bob te deve" or link to group settlement
    await expect(
      page.getByText(/te deve|Ir para acerto do grupo/i).first(),
    ).toBeVisible();

    // ---------------------------------------------------------------
    // 3. Bob views the same expense — sees his debt
    // ---------------------------------------------------------------
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();

    // Login as Bob in separate context
    const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
    const bobLoginResp = await bobPage.request.post(
      `${baseURL}/api/dev/login`,
      { data: { phone: bob.phone, name: bob.name, handle: bob.handle } },
    );
    const bobBody = await bobLoginResp.json();
    if (bobBody.cookies && Array.isArray(bobBody.cookies)) {
      const url = new URL(baseURL);
      await bobContext.addCookies(
        bobBody.cookies.map((c: { name: string; value: string }) => ({
          name: c.name,
          value: c.value,
          domain: url.hostname,
          path: "/",
        })),
      );
    }

    await bobPage.goto(`/app/bill/${expense.id}`);
    await bobPage.waitForLoadState("networkidle");

    // Bob sees the expense title and active status
    await expect(bobPage.getByText("Jantar Lifecycle")).toBeVisible();
    await expect(bobPage.getByText("Ativo")).toBeVisible();

    // Navigate to payment tab
    const bobPaymentTab = bobPage.getByRole("button", { name: /Pagamento/i });
    await bobPaymentTab.click();

    // Bob sees he owes Alice — either direct debt card or group settlement link
    await expect(
      bobPage.getByText(/Voce deve|Ir para acerto do grupo/i).first(),
    ).toBeVisible();

    // ---------------------------------------------------------------
    // 4. Bob navigates to the group and views the settlement tab
    // ---------------------------------------------------------------
    await bobPage.goto(`/app/groups/${group.id}`);
    await bobPage.waitForLoadState("networkidle");

    // Group name visible
    await expect(bobPage.getByText("Lifecycle Test")).toBeVisible();

    // Switch to "Contas" tab — expense should be listed as "Pendente"
    const contasTab = bobPage.getByRole("button", { name: "Contas" });
    await contasTab.click();
    await expect(bobPage.getByText("Jantar Lifecycle")).toBeVisible();
    await expect(bobPage.getByText("Pendente")).toBeVisible();

    // Switch to "Acerto" tab — shows debt edges
    const acertoTab = bobPage.getByRole("button", { name: "Acerto" });
    await acertoTab.click();

    // Bob should see a debt card — he owes R$50 (equal split of R$100)
    await expect(bobPage.getByText("R$ 50,00").first()).toBeVisible({
      timeout: 10000,
    });

    // ---------------------------------------------------------------
    // 5. Settle the debt via seed (simulates Pix payment confirmation)
    // ---------------------------------------------------------------
    // Use seed helper to settle programmatically — the settlement RPC
    // atomically updates the balance to zero.
    const bobClient = await seed.authenticateAs(bob.id);
    await bobClient.rpc("record_and_settle", {
      p_group_id: group.id,
      p_from_user_id: bob.id,
      p_to_user_id: alice.id,
      p_amount_cents: 5000, // R$50,00
    });

    // ---------------------------------------------------------------
    // 6. Alice checks the expense — should now show "Liquidado"
    // ---------------------------------------------------------------
    await page.goto(`/app/bill/${expense.id}`);
    await page.waitForLoadState("networkidle");

    // Status transitions to settled
    await expect(page.getByText("Liquidado")).toBeVisible({ timeout: 10000 });

    // The "Tudo liquidado!" banner should appear on the payment tab
    await page.getByRole("button", { name: /Pagamento/i }).click();
    await expect(page.getByText("Tudo liquidado!")).toBeVisible();

    // ---------------------------------------------------------------
    // 7. Group view reflects settled state
    // ---------------------------------------------------------------
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");

    // "Contas" tab shows "Liquidado" badge
    await page.getByRole("button", { name: "Contas" }).click();
    await expect(page.getByText("Liquidado")).toBeVisible({ timeout: 10000 });

    // "Pagamentos" tab shows the settlement record
    await page.getByRole("button", { name: "Pagamentos" }).click();
    await expect(
      page.getByText(/R\$ 50,00|Confirmado/i).first(),
    ).toBeVisible({ timeout: 10000 });

    // Cleanup
    await bobContext.close();
  });

  test("non-creator sees waiting state for draft expense", async ({
    page,
    seed,
    loginAs,
    browser,
  }) => {
    // Seed users and group
    const alice = await seed.createUser({ name: "Alice Draft" });
    const bob = await seed.createUser({ name: "Bob Draft" });
    const group = await seed.createGroup(alice.id, [bob.id]);

    // Create a draft expense (not activated)
    const draft = await seed.createExpense(
      group.id,
      alice.id,
      [alice.id, bob.id],
      { title: "Rascunho Teste", totalAmount: 8000 },
    );

    // Bob views the draft — should see waiting message
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();

    const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
    const bobLoginResp = await bobPage.request.post(
      `${baseURL}/api/dev/login`,
      { data: { phone: bob.phone, name: bob.name, handle: bob.handle } },
    );
    const bobBody = await bobLoginResp.json();
    if (bobBody.cookies && Array.isArray(bobBody.cookies)) {
      const url = new URL(baseURL);
      await bobContext.addCookies(
        bobBody.cookies.map((c: { name: string; value: string }) => ({
          name: c.name,
          value: c.value,
          domain: url.hostname,
          path: "/",
        })),
      );
    }

    await bobPage.goto(`/app/bill/${draft.id}`);
    await bobPage.waitForLoadState("networkidle");

    // Bob sees draft badge and waiting message
    await expect(bobPage.getByText("Rascunho")).toBeVisible();
    await expect(
      bobPage.getByText(/Aguardando.*finalizar/i),
    ).toBeVisible();
    await expect(bobPage.getByText("R$ 80,00")).toBeVisible();

    // Alice sees the creator draft view with finalize button
    await loginAs(alice);
    await page.goto(`/app/bill/${draft.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Rascunho")).toBeVisible();
    await expect(page.getByText("Rascunho Teste")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Finalizar despesa/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Editar rascunho/i }),
    ).toBeVisible();

    await bobContext.close();
  });
});
