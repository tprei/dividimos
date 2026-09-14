import { test, expect } from "../fixtures";

test.describe("Offline draft", () => {
  test("draft survives reload and an offline submit, then submits exactly once after reconnect", async ({
    page,
    seed,
    loginAs,
    adminClient,
    context,
  }) => {
    const alice = await seed.createUser({ name: "Alice DraftTest" });
    const bob = await seed.createUser({ name: "Bob DraftTest" });
    const group = await seed.createGroup(alice.id, [bob.id], "Grupo Rascunho Offline");

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/bill/new?groupId=${group.id}&title=Offline Bill&amount=10000`);
    await page.waitForLoadState("networkidle");

    // The wizard starts from the URL params and auto-persists the draft to
    // browser storage while the user fills it in.
    await expect(page.getByRole("textbox", { name: "Nome" })).toHaveValue("Offline Bill", {
      timeout: 10000,
    });
    await expect(page.getByRole("textbox", { name: "Valor total R$" })).toHaveValue("100,00");

    const rawDraft = await page.evaluate(() => localStorage.getItem("dividimos-draft"));
    expect(rawDraft).toBeTruthy();
    const draft = JSON.parse(rawDraft!) as { state: { expense: { title: string } | null } };
    expect(draft.state.expense?.title).toBe("Offline Bill");

    // A fresh visit without URL params re-fills the form from the persisted
    // draft, so the entry survives closing the wizard.
    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: "Valor único" }).click();
    await expect(page.getByRole("textbox", { name: "Nome" })).toHaveValue("Offline Bill");
    await expect(page.getByRole("textbox", { name: "Valor total R$" })).toHaveValue("100,00");

    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: /Alice/ }).click();
    await expect(page.getByRole("button", { name: "Criar conta" })).toBeEnabled();

    // Offline submit fails with a retry toast, stays in the wizard and
    // queues nothing on the server: there is no offline write queue.
    await context.setOffline(true);
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page.getByText(/Tente de novo/)).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/app/bill/new");

    const { data: whileOffline } = await adminClient
      .from("expenses")
      .select("id")
      .eq("group_id", group.id);
    expect(whileOffline).toHaveLength(0);

    // Back online, the intact draft submits the bill exactly once.
    await context.setOffline(false);
    await expect(page.getByRole("button", { name: "Criar conta" })).toBeEnabled();
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, { timeout: 15000 });

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("id")
            .eq("group_id", group.id);
          return data?.length ?? 0;
        },
        { timeout: 10000 },
      )
      .toBe(1);

    const { data: expenses } = await adminClient
      .from("expenses")
      .select("id, status, current_version_no")
      .eq("group_id", group.id);
    expect(expenses).toHaveLength(1);
    expect(expenses![0].status).toBe("active");
    expect(expenses![0].current_version_no).toBe(1);

    const { data: versions } = await adminClient
      .from("expense_versions")
      .select("title, total_cents")
      .eq("expense_id", expenses![0].id)
      .eq("version_no", 1);
    expect(versions).toHaveLength(1);
    expect(versions![0].title).toBe("Offline Bill");
    expect(versions![0].total_cents).toBe(10000);

    // The submitted draft is discarded, so revisiting the wizard cannot
    // duplicate the expense.
    const rawAfter = await page.evaluate(() => localStorage.getItem("dividimos-draft"));
    const draftAfter = JSON.parse(rawAfter!) as { state: { expense: unknown } };
    expect(draftAfter.state.expense).toBeNull();

    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: "Valor único" }).click();
    await expect(page.getByRole("textbox", { name: "Nome" })).toHaveValue("");
  });

  test("a draft edited after a reload submits the edited data exactly once", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice EditDraft" });
    const bob = await seed.createUser({ name: "Bob EditDraft" });
    const group = await seed.createGroup(alice.id, [bob.id], "Grupo Edicao Rascunho");

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/bill/new?groupId=${group.id}&title=Rascunho Editavel&amount=5000`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("textbox", { name: "Nome" })).toHaveValue("Rascunho Editavel", {
      timeout: 10000,
    });

    // Reload without the URL params: the draft is restored from storage and
    // remains editable, replacing the legacy server-side "Editar rascunho".
    await page.goto("/app/bill/new");
    await page.getByRole("button", { name: "Valor único" }).click();
    const nome = page.getByRole("textbox", { name: "Nome" });
    await expect(nome).toHaveValue("Rascunho Editavel", { timeout: 10000 });
    await nome.fill("Jantar Editado");
    await page.getByRole("textbox", { name: "Valor total R$" }).fill("75,50");

    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: /Alice/ }).click();
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page).toHaveURL(/\/app\/bill\/[0-9a-f-]{8,}/i, { timeout: 15000 });

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from("expenses")
            .select("id")
            .eq("group_id", group.id);
          return data?.length ?? 0;
        },
        { timeout: 10000 },
      )
      .toBe(1);

    const { data: expenses } = await adminClient
      .from("expenses")
      .select("id, status, current_version_no")
      .eq("group_id", group.id);
    expect(expenses).toHaveLength(1);
    expect(expenses![0].status).toBe("active");
    expect(expenses![0].current_version_no).toBe(1);

    const { data: versions } = await adminClient
      .from("expense_versions")
      .select("title, total_cents")
      .eq("expense_id", expenses![0].id)
      .eq("version_no", 1);
    expect(versions).toHaveLength(1);
    expect(versions![0].title).toBe("Jantar Editado");
    expect(versions![0].total_cents).toBe(7550);
  });
});
