import { test, expect } from "../fixtures";

test.describe("DM conversations list", () => {
  test("estado vazio quando usuário não tem conversas", async ({
    page,
    seed,
    loginAs,
  }) => {
    const solo = await seed.createUser({ name: "Solo User" });

    await loginAs(solo);
    await page.goto("/app/conversations");
    await expect(page.getByText("Conversas")).toBeVisible();

    await expect(page.getByText("Nenhuma conversa")).toBeVisible();
    await expect(
      page.getByPlaceholder("Buscar por nome, @handle ou mensagem..."),
    ).not.toBeVisible();
  });

  test("múltiplas conversas listadas com saldos variados", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const [alice, bob, carol, dan] = await Promise.all([
      seed.createUser({ name: "Alice Lista" }),
      seed.createUser({ name: "Bob Lista" }),
      seed.createUser({ name: "Carol Lista" }),
      seed.createUser({ name: "Dan Lista" }),
    ]);

    const acceptAt = new Date().toISOString();

    const [gBob, gCarol, gDan] = await Promise.all([
      seed.createGroup(alice.id, [bob.id]),
      seed.createGroup(alice.id, [carol.id]),
      seed.createGroup(alice.id, [dan.id]),
    ]);

    await Promise.all([
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gBob.id)
        .eq("user_id", bob.id),
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gCarol.id)
        .eq("user_id", carol.id),
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gDan.id)
        .eq("user_id", dan.id),
    ]);

    const [dmBob, dmCarol, dmDan] = await Promise.all([
      seed.createDmGroup(alice, bob),
      seed.createDmGroup(alice, carol),
      seed.createDmGroup(alice, dan),
    ]);

    await Promise.all([
      seed.createActiveExpense(dmBob.id, bob.id, [alice.id, bob.id], {
        title: "Uber compartilhado",
        totalAmount: 10000,
      }),
      seed.sendChatMessage(dmBob.id, alice.id, "pegamos o uber ontem"),
      seed.sendChatMessage(dmCarol.id, alice.id, "tudo bem?"),
      seed.createActiveExpense(dmDan.id, alice.id, [alice.id, dan.id], {
        title: "Almoço",
        totalAmount: 4000,
      }),
    ]);

    await loginAs(alice);
    await page.goto("/app/conversations");
    await expect(page.getByText("Conversas")).toBeVisible();

    await expect(page.getByText("Bob Lista")).toBeVisible();
    await expect(page.getByText("Carol Lista")).toBeVisible();
    await expect(page.getByText("Dan Lista")).toBeVisible();

    await expect(page.getByText(/R\$\s*\d/).first()).toBeVisible();
  });

  test("busca filtra por nome", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const [alice, bob, carol, dan] = await Promise.all([
      seed.createUser({ name: "Alice Busca Nome" }),
      seed.createUser({ name: "Bob Busca Nome" }),
      seed.createUser({ name: "Carol Busca Nome" }),
      seed.createUser({ name: "Dan Busca Nome" }),
    ]);

    const acceptAt = new Date().toISOString();

    const [gBob, gCarol, gDan] = await Promise.all([
      seed.createGroup(alice.id, [bob.id]),
      seed.createGroup(alice.id, [carol.id]),
      seed.createGroup(alice.id, [dan.id]),
    ]);

    await Promise.all([
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gBob.id)
        .eq("user_id", bob.id),
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gCarol.id)
        .eq("user_id", carol.id),
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gDan.id)
        .eq("user_id", dan.id),
    ]);

    await Promise.all([
      seed.createDmGroup(alice, bob),
      seed.createDmGroup(alice, carol),
      seed.createDmGroup(alice, dan),
    ]);

    await loginAs(alice);
    await page.goto("/app/conversations");
    await expect(page.getByText("Conversas")).toBeVisible();

    const searchInput = page.getByPlaceholder(
      "Buscar por nome, @handle ou mensagem...",
    );
    await searchInput.fill("Bob");

    await expect(page.getByText("Bob Busca Nome")).toBeVisible();
    await expect(page.getByText("Carol Busca Nome")).not.toBeVisible();
    await expect(page.getByText("Dan Busca Nome")).not.toBeVisible();
  });

  test("busca filtra por handle", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const [alice, ze, outro] = await Promise.all([
      seed.createUser({ name: "Alice Handle" }),
      seed.createUser({ name: "Zé Coringa", handle: "ze_coringa" }),
      seed.createUser({ name: "Outro Handle" }),
    ]);

    const acceptAt = new Date().toISOString();

    const [gZe, gOutro] = await Promise.all([
      seed.createGroup(alice.id, [ze.id]),
      seed.createGroup(alice.id, [outro.id]),
    ]);

    await Promise.all([
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gZe.id)
        .eq("user_id", ze.id),
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gOutro.id)
        .eq("user_id", outro.id),
    ]);

    await Promise.all([
      seed.createDmGroup(alice, ze),
      seed.createDmGroup(alice, outro),
    ]);

    await loginAs(alice);
    await page.goto("/app/conversations");
    await expect(page.getByText("Conversas")).toBeVisible();

    const searchInput = page.getByPlaceholder(
      "Buscar por nome, @handle ou mensagem...",
    );
    await searchInput.fill("coringa");

    await expect(page.getByText("Zé Coringa")).toBeVisible();
    await expect(page.getByText("Outro Handle")).not.toBeVisible();
  });

  test("busca filtra pelo conteúdo da última mensagem", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const [alice, bob, carol] = await Promise.all([
      seed.createUser({ name: "Alice Msg" }),
      seed.createUser({ name: "Bob Msg" }),
      seed.createUser({ name: "Carol Msg" }),
    ]);

    const acceptAt = new Date().toISOString();

    const [gBob, gCarol] = await Promise.all([
      seed.createGroup(alice.id, [bob.id]),
      seed.createGroup(alice.id, [carol.id]),
    ]);

    await Promise.all([
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gBob.id)
        .eq("user_id", bob.id),
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gCarol.id)
        .eq("user_id", carol.id),
    ]);

    const [dmBob, dmCarol] = await Promise.all([
      seed.createDmGroup(alice, bob),
      seed.createDmGroup(alice, carol),
    ]);

    await Promise.all([
      seed.sendChatMessage(dmBob.id, alice.id, "pegamos um uber"),
      seed.sendChatMessage(dmCarol.id, alice.id, "almoço"),
    ]);

    await loginAs(alice);
    await page.goto("/app/conversations");
    await expect(page.getByText("Conversas")).toBeVisible();

    const searchInput = page.getByPlaceholder(
      "Buscar por nome, @handle ou mensagem...",
    );
    await searchInput.fill("uber");

    await expect(page.getByText("Bob Msg")).toBeVisible();
    await expect(page.getByText("Carol Msg")).not.toBeVisible();
  });

  test("busca requer mínimo de 2 caracteres — 1 caractere mostra tudo", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const [alice, bob, carol] = await Promise.all([
      seed.createUser({ name: "Alice Filtro" }),
      seed.createUser({ name: "Bob Filtro" }),
      seed.createUser({ name: "Carol Filtro" }),
    ]);

    const acceptAt = new Date().toISOString();

    const [gBob, gCarol] = await Promise.all([
      seed.createGroup(alice.id, [bob.id]),
      seed.createGroup(alice.id, [carol.id]),
    ]);

    await Promise.all([
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gBob.id)
        .eq("user_id", bob.id),
      adminClient
        .from("group_members")
        .update({ status: "accepted", accepted_at: acceptAt })
        .eq("group_id", gCarol.id)
        .eq("user_id", carol.id),
    ]);

    await Promise.all([
      seed.createDmGroup(alice, bob),
      seed.createDmGroup(alice, carol),
    ]);

    await loginAs(alice);
    await page.goto("/app/conversations");
    await expect(page.getByText("Conversas")).toBeVisible();

    const searchInput = page.getByPlaceholder(
      "Buscar por nome, @handle ou mensagem...",
    );

    await searchInput.fill("B");
    await expect(page.getByText("Bob Filtro")).toBeVisible();
    await expect(page.getByText("Carol Filtro")).toBeVisible();

    await searchInput.fill("");
    await expect(page.getByText("Bob Filtro")).toBeVisible();
    await expect(page.getByText("Carol Filtro")).toBeVisible();
  });

  test("convites pendentes exibidos com botões de aceitar e recusar", async ({
    page,
    seed,
    loginAs,
  }) => {
    const [alice, bob] = await Promise.all([
      seed.createUser({ name: "Alice Convite" }),
      seed.createUser({ name: "Bob Convite" }),
    ]);

    await seed.createDmGroup(bob, alice);

    await loginAs(alice);
    await page.goto("/app/conversations");
    await expect(page.getByText("Conversas")).toBeVisible();

    await expect(page.getByText("Convites pendentes")).toBeVisible();
    await expect(page.getByText("Bob Convite")).toBeVisible();
    await expect(page.getByRole("button", { name: "Aceitar" })).toBeVisible();
  });
});
