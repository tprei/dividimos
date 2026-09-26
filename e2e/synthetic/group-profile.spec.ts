import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

async function pullDown(page: Page, travel: number) {
  const cdp = await page.context().newCDPSession(page);
  const x = 200;
  const y = 260;
  const steps = 12;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  for (let step = 1; step <= steps; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + (step * travel) / steps, id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.describe("Group profile behind the header", () => {
  test("opens from the header and shows what the group has spent", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Perfil" });
    const bob = await seed.createUser({ name: "Bob Perfil" });
    const group = await seed.createGroup(alice.id, [bob.id], "Grupo Perfil");
    await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Conta do perfil",
      totalCents: 12000,
      expenseType: "single_amount",
    });

    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);

    await page.getByRole("button", { name: "Ver perfil do grupo" }).first().click();

    await expect(page).toHaveURL(new RegExp(`/app/groups/${group.id}\\?view=info$`));
    await expect(page.getByRole("radio", { name: "Saldos" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Grupo Perfil", level: 1 })).toBeVisible();
    await expect(page.getByTestId("group-spending")).toContainText("120,00");
    await expect(page.getByRole("button", { name: "Convidar" })).toBeVisible();
    await page.getByRole("button", { name: /2 pessoas/ }).click();
    await expect(page).toHaveURL(new RegExp(`/app/groups/${group.id}$`));
    await expect(page.getByRole("radio", { name: "Membros" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Remover Bob Perfil" })).toBeVisible();
  });

  test("the browser back button closes the profile", async ({ page, seed, loginAs }) => {
    const alice = await seed.createUser({ name: "Alice Voltar" });
    const group = await seed.createGroup(alice.id, [], "Grupo Voltar");

    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.getByRole("button", { name: "Ver perfil do grupo" }).first().click();
    await expect(page.getByRole("button", { name: "Convidar" })).toBeVisible();

    await page.goBack();

    await expect(page).toHaveURL(new RegExp(`/app/groups/${group.id}$`));
    await expect(page.getByRole("radio", { name: "Saldos" })).toBeVisible();
  });

  test("a deliberate pull opens the profile and a second pull closes it", async ({
    page,
    seed,
    loginAs,
    browserName,
    isMobile,
  }) => {
    test.skip(browserName !== "chromium" || !isMobile, "CDP touch input needs mobile Chromium");
    const alice = await seed.createUser({ name: "Alice Puxa" });
    const group = await seed.createGroup(alice.id, [], "Grupo Puxa");

    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await expect(page.getByRole("radio", { name: "Saldos" })).toBeVisible();
    await page.waitForTimeout(400);

    await pullDown(page, 80);
    await expect(page).toHaveURL(new RegExp(`/app/groups/${group.id}$`));

    await page.waitForTimeout(400);
    await pullDown(page, 320);
    await expect(page).toHaveURL(new RegExp(`/app/groups/${group.id}\\?view=info$`));
    await expect(page.getByRole("button", { name: "Convidar" })).toBeVisible();

    await page.waitForTimeout(600);
    await pullDown(page, 320);
    await expect(page).toHaveURL(new RegExp(`/app/groups/${group.id}$`));
    await expect(page.getByRole("radio", { name: "Saldos" })).toBeVisible();
  });
});
