import { test, expect } from "../fixtures";

test.describe("Security: abuse limits surface in the UI", () => {
  test("the 31st chat message in a minute is refused with the flood copy and never stored", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Enxurrada" });
    const bob = await seed.createUser({ name: "Bob Enxurrada" });
    const group = await seed.createGroup(alice.id, [bob.id], "Grupo da enxurrada");
    for (let index = 0; index < 30; index += 1) {
      await seed.sendChatMessage(group.id, alice.id, `Spam ${index}`);
    }

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/groups/${group.id}/chat`);
    await page.waitForLoadState("networkidle");

    const composer = page.getByRole("textbox", { name: "Mensagem", exact: true });
    await composer.fill("Mensagem trigésima primeira");
    await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
    await expect(
      page.getByText("Calma! Muitas mensagens seguidas. Espere um instante e tente de novo."),
    ).toBeVisible({ timeout: 10000 });

    const { data } = await adminClient
      .from("chat_messages")
      .select("id")
      .eq("group_id", group.id)
      .eq("content", "Mensagem trigésima primeira");
    expect(data).toEqual([]);
  });

  test("an inviter already holding ten pending invitations to someone is refused the eleventh", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const attacker = await seed.createUser({ name: "Atacante Convites" });
    const victim = await seed.createUser({ name: "Vitima Convites" });
    for (let index = 0; index < 10; index += 1) {
      const flood = await seed.createGroup(attacker.id, [], `Pix devolvido ${index}`);
      await seed.inviteMember(attacker.id, flood.id, victim.id);
    }
    const target = await seed.createGroup(attacker.id, [], "Pix devolvido 11");

    await loginAs(attacker);
    await page.goto(`/app/groups/${target.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("radio", { name: "Membros" }).click();
    await page.getByRole("button", { name: /Convidar/i }).click();
    await page.getByPlaceholder("handle do usuario").fill(victim.handle);
    await page.locator("button", { has: page.locator("svg.lucide-search") }).click();
    await expect(page.getByTestId("lookup-result")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("lookup-result").getByRole("button", { name: /Convidar/i }).click();

    await expect(
      page.getByText("Você já tem convites pendentes demais pra essa pessoa. Espere ela responder."),
    ).toBeVisible({ timeout: 10000 });

    const { data } = await adminClient
      .from("group_members")
      .select("group_id")
      .eq("user_id", victim.id)
      .eq("status", "invited")
      .eq("invited_by", attacker.id);
    expect(data).toHaveLength(10);
  });
});
