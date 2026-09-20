import { test, expect } from "../fixtures";

test.describe("Guest invite can be scanned", () => {
  test("offers a QR code alongside the link actions", async ({ page, seed, loginAs }) => {
    const alice = await seed.createUser({ name: "Alice Anfitriã" });
    const group = await seed.createGroup(alice.id, [], "Grupo Convidado");
    const expense = await seed.createExpense(group.id, alice.id, [alice.id], {
      title: "Café com convidado",
      totalCents: 5000,
      expenseType: "single_amount",
      participants: [
        { kind: "user", userId: alice.id },
        { kind: "guest", guestId: null, displayName: "Jj" },
      ],
      shares: [2500, 2500],
      payers: [{ participantIndex: 0, amountCents: 5000 }],
    });

    await loginAs(alice);
    await page.goto(`/app/bill/${expense.id}`);

    await page.getByRole("button", { name: /^Convidar/ }).click();
    await page.getByRole("button", { name: /Gerar link/ }).click();

    await page.getByRole("button", { name: "Mostrar QR code" }).click();

    // The claim URL is drawn, never printed: the app's own reader at /auth
    // decodes this exact payload.
    await expect(page.getByText("Escaneie pelo app para entrar na conta")).toBeVisible();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copiar link" })).toBeVisible();
  });
});
