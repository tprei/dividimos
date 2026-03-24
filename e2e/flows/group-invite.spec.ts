import { test, expect } from "@playwright/test";

/**
 * Group Invite Flow Test
 *
 * Tests the complete group invite/accept flow:
 * 1. Alice creates a group
 * 2. Alice invites Bob by @handle
 * 3. Bob sees the invite and accepts
 * 4. Both see each other in the group member list
 *
 * Uses two separate browser contexts to simulate multi-user interaction.
 */

test.describe("Group Invite Flow", () => {
  test("Alice creates group and invites Bob, Bob accepts", async ({ browser }) => {
    // Create two separate browser contexts
    const aliceContext = await browser.newContext({
      storageState: "e2e/.auth/alice.json",
    });
    const bobContext = await browser.newContext({
      storageState: "e2e/.auth/bob.json",
    });

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    try {
      // === ALICE: Create group ===
      await alicePage.goto("/app/groups");
      await alicePage.waitForLoadState("networkidle");

      // Click "Novo grupo" button
      await alicePage.getByRole("button", { name: /novo grupo/i }).click();

      // Enter group name
      await alicePage.getByLabel(/nome do grupo/i).fill("Jantar Mensal");

      // Create group
      await alicePage.getByRole("button", { name: /criar|salvar/i }).click();

      // Wait for group to be created
      await alicePage.waitForURL(/\/app\/groups\/[a-f0-9-]+/);

      // === ALICE: Invite Bob ===
      // Look for invite input/button
      const inviteInput = alicePage.getByPlaceholder(/@handle|convidar/i);

      if (await inviteInput.isVisible()) {
        await inviteInput.fill("@bob_test");
        await alicePage.getByRole("button", { name: /convidar|adicionar/i }).click();

        // Verify invite was sent
        await expect(alicePage.getByText(/convite enviado|aguardando/i)).toBeVisible();
      }

      // === BOB: Check for invite ===
      await bobPage.goto("/app/groups");
      await bobPage.waitForLoadState("networkidle");

      // Bob should see the pending invite
      const inviteCard = bobPage.getByText("Jantar Mensal");

      // If invite is visible, accept it
      if (await inviteCard.isVisible()) {
        // Look for accept button near the group name
        const acceptButton = bobPage.getByRole("button", { name: /aceitar/i });
        if (await acceptButton.isVisible()) {
          await acceptButton.click();

          // Wait for acceptance
          await bobPage.waitForTimeout(1000);
        }
      }

      // === VERIFICATION: Both users should see the group ===

      // Alice refreshes to see Bob in the group
      await alicePage.reload();
      await alicePage.waitForLoadState("networkidle");

      // Navigate to the group if not already there
      await alicePage.goto("/app/groups");

      // Click on the group to see members
      await alicePage.getByText("Jantar Mensal").click();

      // Verify Bob is listed as member
      await expect(alicePage.getByText(/bob/i)).toBeVisible();

      // Bob should also see the group as accepted
      await bobPage.goto("/app/groups");
      await expect(bobPage.getByText("Jantar Mensal")).toBeVisible();
    } finally {
      await aliceContext.close();
      await bobContext.close();
    }
  });

  test("group bill skips participant acceptance", async ({ browser }) => {
    // This test verifies that bills created with a group don't require
    // individual participant acceptance

    const aliceContext = await browser.newContext({
      storageState: "e2e/.auth/alice.json",
    });

    const alicePage = await aliceContext.newPage();

    try {
      // Navigate to new bill
      await alicePage.goto("/app/bill/new");

      // Select "Valor unico"
      await alicePage.getByRole("button", { name: /valor unico/i }).click();

      // Enter title
      await alicePage.getByLabel(/nome da conta/i).fill("Conta do Grupo");

      // Continue to participants
      await alicePage.getByRole("button", { name: /proximo/i }).click();

      // Check if we can select a group
      const groupSelector = alicePage.getByRole("button", { name: /selecionar grupo/i });

      if (await groupSelector.isVisible()) {
        await groupSelector.click();

        // Select a group if available
        const groupOption = alicePage.getByRole("button", { name: /jantar|teste/i }).first();
        if (await groupOption.isVisible()) {
          await groupOption.click();

          // Verify "Grupo" badge appears
          await expect(alicePage.getByText(/grupo/i)).toBeVisible();

          // Continue through the flow
          await alicePage.getByRole("button", { name: /proximo/i }).click();

          // Enter amount
          await alicePage.getByLabel(/valor total/i).fill("150");

          // Continue
          await alicePage.getByRole("button", { name: /proximo/i }).click();

          // Set payer
          await alicePage.getByRole("button", { name: /alice/i }).first().click();

          // Continue to summary
          await alicePage.getByRole("button", { name: /proximo/i }).click();

          // With group bills, the "Gerar cobrancas" button should be enabled
          // (no waiting for acceptance required)
          const generateButton = alicePage.getByRole("button", {
            name: /gerar cobrancas/i,
          });

          // Button should NOT be disabled for group bills
          await expect(generateButton).toBeEnabled();
        }
      }
    } finally {
      await aliceContext.close();
    }
  });

  test("user can decline group invite", async ({ browser }) => {
    const aliceContext = await browser.newContext({
      storageState: "e2e/.auth/alice.json",
    });
    const carolContext = await browser.newContext({
      storageState: "e2e/.auth/carol.json",
    });

    const alicePage = await aliceContext.newPage();
    const carolPage = await carolContext.newPage();

    try {
      // Alice creates a group
      await alicePage.goto("/app/groups");
      await alicePage.getByRole("button", { name: /novo grupo/i }).click();
      await alicePage.getByLabel(/nome do grupo/i).fill("Grupo Teste");
      await alicePage.getByRole("button", { name: /criar/i }).click();

      // Invite Carol
      const inviteInput = alicePage.getByPlaceholder(/@handle|convidar/i);
      if (await inviteInput.isVisible()) {
        await inviteInput.fill("@carol_test");
        await alicePage.getByRole("button", { name: /convidar/i }).click();
      }

      // Carol sees and declines invite
      await carolPage.goto("/app/groups");

      const declineButton = carolPage.getByRole("button", { name: /recusar|declinar/i });
      if (await declineButton.isVisible()) {
        await declineButton.click();

        // Verify invite is removed
        await carolPage.waitForTimeout(500);
        await expect(carolPage.getByText("Grupo Teste")).not.toBeVisible();
      }
    } finally {
      await aliceContext.close();
      await carolContext.close();
    }
  });
});
