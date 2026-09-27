import { expect, test } from "../fixtures";

test.describe("Account deletion", () => {
  test("settles, deletes, wipes this device, and preserves another member's history", async ({
    page,
    seed,
    loginAs,
    newSession,
    adminClient,
  }) => {
    const leaver = await seed.createUser({ name: "Leaver Conta" });
    const survivor = await seed.createUser({ name: "Sobrevivente Silva" });
    const group = await seed.createGroup(leaver.id, [survivor.id], "Grupo da exclusão");

    await seed.createExpense(group.id, leaver.id, [leaver.id, survivor.id], {
      title: "Conta com acerto",
      totalCents: 1000,
      expenseType: "single_amount",
    });
    await seed.createExpenseWithSettlements(group.id, leaver.id, [leaver.id, survivor.id], {
      title: "Conta quitada",
      totalCents: 2000,
      expenseType: "single_amount",
    });

    await loginAs(leaver);
    await page.goto("/app/settings?excluir=1");

    await page.getByLabel("Entendi e quero excluir minha conta do Dividimos.").check();
    await page.getByRole("button", { name: "Excluir minha conta do Dividimos" }).click();
    await expect(page.getByText("Sua conta do Dividimos foi excluída.")).toBeVisible();
    await expect(page).toHaveURL(/\/excluir-conta\?excluida=1/);

    const { data: deletedProfile } = await adminClient
      .from("users")
      .select("deleted_at, name")
      .eq("id", leaver.id)
      .single();
    expect(deletedProfile?.deleted_at).not.toBeNull();
    expect(deletedProfile?.name).toBe("Conta excluída");

    const { context: survivorCtx, page: survivorPage } = await newSession(survivor);
    await survivorPage.goto(`/app/groups/${group.id}`);
    await survivorPage.getByRole("radio", { name: "Contas" }).click();
    await survivorPage.getByRole("link", { name: /Conta com acerto/ }).click();
    await expect(survivorPage.getByText("Conta excluída").first()).toBeVisible();
    await survivorCtx.close();
  });

  test("shows open-balance group links instead of deleting", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const debtor = await seed.createUser({ name: "Devedor Conta" });
    const creditor = await seed.createUser({ name: "Credor Conta" });
    const group = await seed.createGroup(debtor.id, [creditor.id], "Grupo devendo");

    await seed.createExpense(group.id, creditor.id, [debtor.id, creditor.id], {
      title: "Jantar não pago",
      totalCents: 5000,
      expenseType: "single_amount",
    });

    await loginAs(debtor);
    await page.goto("/app/settings?excluir=1");

    await page.getByLabel("Entendi e quero excluir minha conta do Dividimos.").check();
    await page.getByRole("button", { name: "Excluir minha conta do Dividimos" }).click();
    await expect(
      page.getByText("Antes de excluir sua conta do Dividimos, acerte os saldos destes grupos."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir grupo Grupo devendo" })).toBeVisible();

    const { data: profile } = await adminClient
      .from("users")
      .select("deleted_at")
      .eq("id", debtor.id)
      .single();
    expect(profile?.deleted_at).toBeNull();
  });

  test("opens the public deletion page without auth and preserves the settings return link", async ({
    page,
  }) => {
    await page.goto("/excluir-conta");

    await expect(page.getByRole("heading", { name: "Excluir sua conta do Dividimos" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Entrar para excluir minha conta" }),
    ).toHaveAttribute("href", "/auth?next=%2Fapp%2Fsettings%3Fexcluir%3D1");
    await expect(page.getByRole("link", { name: "contato@dividimos.ai" })).toBeVisible();
  });

  test("resumes a deletion whose application transaction already committed", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const leaver = await seed.createUser({ name: "Leaver Pendente" });
    const survivor = await seed.createUser({ name: "Sobrevivente Pendente" });
    await seed.createGroup(leaver.id, [survivor.id], "Grupo pendente");

    const { error } = await adminClient.rpc("delete_account", { p_user_id: leaver.id });
    expect(error).toBeNull();

    await loginAs(leaver);
    await page.goto("/app");

    await expect(page.getByText("Falta encerrar o acesso")).toBeVisible();
    await page.getByRole("button", { name: "Concluir exclusão" }).click();
    await expect(page).toHaveURL(/\/excluir-conta\?excluida=1/);
  });
});
