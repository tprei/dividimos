import type { SupabaseClient } from "@supabase/supabase-js";
import { test, expect } from "../fixtures";

async function createInviteLink(client: SupabaseClient, groupId: string): Promise<string> {
  const { data, error } = await client.rpc("create_invite_link", { p_group_id: groupId });
  if (error) throw new Error(`create_invite_link failed: ${error.message}`);
  const token = (data as { token?: unknown } | null)?.token;
  if (typeof token !== "string") throw new Error("create_invite_link returned no token");
  return token;
}

test.describe("Security: invite links respect blocks and removals", () => {
  test("a user blocked by the group creator cannot enter through another member's link", async ({
    seed,
    newSession,
    adminClient,
  }) => {
    const ana = await seed.createUser({ name: "Ana Bloqueio" });
    const carol = await seed.createUser({ name: "Carol Bloqueio" });
    const bruno = await seed.createUser({ name: "Bruno Bloqueado" });
    const group = await seed.createGroup(ana.id, [carol.id], "Grupo da Ana");

    const anaClient = await seed.authenticateAs(ana.id);
    const { error: blockError } = await anaClient.rpc("block_user", { p_user_id: bruno.id });
    expect(blockError).toBeNull();
    const token = await createInviteLink(await seed.authenticateAs(carol.id), group.id);

    const { context, page } = await newSession(bruno);
    await page.goto(`/join/${token}`);
    await expect(page.getByRole("heading", { name: "Grupo da Ana" })).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Entrar no grupo" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Não foi possível incluir essa pessoa nessa interação." }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(new RegExp(`/join/${token}$`));

    const { data } = await adminClient
      .from("group_members")
      .select("user_id")
      .eq("group_id", group.id)
      .eq("user_id", bruno.id);
    expect(data).toEqual([]);

    await context.close();
  });

  test("a removed member's invite link stops admitting anyone", async ({
    seed,
    newSession,
    adminClient,
  }) => {
    const ana = await seed.createUser({ name: "Ana Remocao" });
    const carol = await seed.createUser({ name: "Carol Removida" });
    const sockpuppet = await seed.createUser({ name: "Conta Nova" });
    const group = await seed.createGroup(ana.id, [carol.id], "Grupo sem a Carol");

    const token = await createInviteLink(await seed.authenticateAs(carol.id), group.id);
    const anaClient = await seed.authenticateAs(ana.id);
    const { error: removeError } = await anaClient.rpc("remove_member", {
      p_group_id: group.id,
      p_user_id: carol.id,
    });
    expect(removeError).toBeNull();

    const { context, page } = await newSession(sockpuppet);
    await page.goto(`/join/${token}`);
    await expect(page.getByRole("heading", { name: "Este convite não é mais válido." })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: "Entrar no grupo" })).not.toBeVisible();

    const { data } = await adminClient
      .from("group_members")
      .select("user_id")
      .eq("group_id", group.id)
      .eq("user_id", sockpuppet.id);
    expect(data).toEqual([]);

    await context.close();
  });
});
