import { test, expect } from "../fixtures";

test.describe("Expenses with a pending invitee", () => {
  test("the wizard creates a group and its first expense before the invitee accepts", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Pendente" });
    const bob = await seed.createUser({ name: "Bob Pendente" });

    await loginAs(alice, { navigate: false });
    await page.goto("/app/bill/new?title=Jantar%20pendente&amount=8000");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Valor único/ }).click();
    await page.getByRole("textbox", { name: "Valor total R$" }).click();
    await page.keyboard.type("8000");
    await page.getByRole("textbox", { name: "Nome" }).fill("Jantar pendente");

    await page.getByRole("button", { name: /Participantes/ }).click();
    await page.getByRole("button", { name: "Por @handle" }).click();
    await page.getByPlaceholder("handle do usuario").fill(bob.handle);
    await page.getByRole("button", { name: "Buscar handle" }).click();
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByText(bob.name).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Concluir" }).click();

    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: /Alice/ }).click();
    await page.getByRole("button", { name: "Criar conta" }).click();

    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{36}/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: "Jantar pendente" })).toBeVisible();
    await expect(page.getByText("Convite pendente").first()).toBeVisible();

    const { data: members } = await adminClient
      .from("group_members")
      .select("user_id, status")
      .eq("user_id", bob.id);
    expect(members?.[0]?.status).toBe("invited");
  });

  test("declining the invitation invalidates the shared expense", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Recusa" });
    const bob = await seed.createUser({ name: "Bob Recusa" });

    const group = await seed.createGroup(alice.id, [], "Grupo Recusa");
    const aliceClient = await seed.authenticateAs(alice.id);
    await aliceClient.rpc("invite_member", { p_group_id: group.id, p_user_id: bob.id });

    const expense = await seed.createExpense(group.id, alice.id, [alice.id, bob.id], {
      title: "Conta recusada",
      totalCents: 4000,
      expenseType: "single_amount",
    });

    const bobClient = await seed.authenticateAs(bob.id);
    const { error } = await bobClient.rpc("decline_invitation", { p_group_id: group.id });
    expect(error).toBeNull();

    const { data: rows } = await adminClient
      .from("expenses")
      .select("id, status")
      .eq("id", expense.id);
    expect(rows?.[0]?.status).toBe("deleted");

    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Conta recusada")).not.toBeVisible();
  });
});
