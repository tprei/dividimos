import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUser,
  createTestUsers,
  equalSplitPayload,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

const ENCRYPTED_PIX = `${"A".repeat(16)}:${"B".repeat(22)}==:${"C".repeat(24)}`;

function rpcErrorCode(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<string> {
  return expectRpcError(Promise.resolve(client.rpc(fn, args)));
}

async function messageCount(groupId: string): Promise<number> {
  return withPg(async (pg) => {
    const { rows } = await pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.chat_messages WHERE group_id = $1",
      [groupId],
    );
    return rows[0].count;
  });
}

describe.skipIf(!isIntegrationTestReady)("objectionable text filter", () => {
  let alice: TestUser;
  let bob: TestUser;
  let outsider: TestUser;
  let clientAlice: SupabaseClient;
  let groupId: string;

  beforeAll(async () => {
    [alice, bob, outsider] = await createTestUsers(3);
    clientAlice = authenticateAs(alice);
    groupId = await createGroupWithMembers(alice, [bob], "Grupo filtro");
  });

  it("refuses a chat message with a slur, folding case and accents, and stores nothing", async () => {
    const before = await messageCount(groupId);
    for (const content of ["seu VIADÃO", "valeu, n1 nigga", "mongolo\u0301ide", "ni\u01F5ga", "nig\u0301ga", "_fag_"]) {
      expect(
        await rpcErrorCode(clientAlice, "send_message", {
          p_client_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_content: content,
        }),
      ).toBe("objectionable_content");
    }
    expect(await messageCount(groupId)).toBe(before);
  });

  it("accepts everyday words that only contain a listed term, and plain profanity", async () => {
    for (const content of ["Passamos pelo viaduto", "porra, que conta cara", "galinha crioula", "fagβ", "βfag"]) {
      const p_client_id = crypto.randomUUID();
      const { data, error } = await clientAlice.rpc("send_message", {
        p_client_id,
        p_group_id: groupId,
        p_content: content,
      });
      expect(error).toBeNull();
      expect(data).toMatchObject({ clientId: p_client_id, content });
      const persisted = await withPg(async (pg) => {
        const { rows } = await pg.query<{ content: string }>(
          "SELECT content FROM public.chat_messages WHERE client_id = $1",
          [p_client_id],
        );
        return rows[0].content;
      });
      expect(persisted).toBe(content);
    }
  });

  it("returns the original message for a replayed client id even when the retry text is objectionable", async () => {
    const p_client_id = crypto.randomUUID();
    const first = await clientAlice.rpc("send_message", {
      p_client_id,
      p_group_id: groupId,
      p_content: "ouviste o novo disco?",
    });
    expect(first.error).toBeNull();

    const retry = await clientAlice.rpc("send_message", {
      p_client_id,
      p_group_id: groupId,
      p_content: "seu VIADÃO",
    });
    expect(retry.error).toBeNull();
    expect(retry.data).toEqual(first.data);
    expect(retry.data).toMatchObject({ clientId: p_client_id, content: "ouviste o novo disco?" });

    const stored = await withPg(async (pg) => {
      const { rows } = await pg.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.chat_messages WHERE client_id = $1",
        [p_client_id],
      );
      return rows[0].count;
    });
    expect(stored).toBe(1);
  });

  it("still denies a non-member before anything else is written", async () => {
    const before = await messageCount(groupId);
    expect(
      await rpcErrorCode(authenticateAs(outsider), "send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_content: "oi",
      }),
    ).toBe("not_a_member");
    expect(
      await rpcErrorCode(authenticateAs(outsider), "send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_content: "seu VIADÃO",
      }),
    ).toBe("not_a_member");
    expect(await messageCount(groupId)).toBe(before);
  });

  it("refuses a group name with a slur, including through create_expense_with_group", async () => {
    expect(
      await rpcErrorCode(clientAlice, "create_group", { p_name: "Os Bichonas", p_member_ids: [] }),
    ).toBe("objectionable_content");
    expect(
      await rpcErrorCode(clientAlice, "create_expense_with_group", {
        p_client_id: crypto.randomUUID(),
        p_group_name: "faggots trip",
        p_member_ids: [],
        p_occurred_on: "2026-10-05",
        p_title: "Jantar",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 1000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: equalSplitPayload([alice.id], 1000),
      }),
    ).toBe("objectionable_content");
    const leftover = await withPg(async (pg) => {
      const { rows } = await pg.query<{ groups: number; expenses: number }>(
        `SELECT
           (SELECT count(*)::int FROM public.groups WHERE name IN ('Os Bichonas', 'faggots trip')) AS groups,
           (SELECT count(*)::int FROM public.expenses e
              JOIN public.groups g ON g.id = e.group_id
              WHERE g.name IN ('Os Bichonas', 'faggots trip')) AS expenses`,
      );
      return rows[0];
    });
    expect(leftover).toEqual({ groups: 0, expenses: 0 });
  });

  it("refuses a group invitation from a caller whose inherited identity is still objectionable", async () => {
    const fresh = await createTestUser({
      name: "Mongolóide",
      handle: `ana_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      onboarded: false,
    });
    const target = await createTestUser({});
    const client = authenticateAs(fresh);
    const p_name = `Grupo limpo ${fresh.id.slice(0, 8)}`;

    expect(
      await rpcErrorCode(client, "create_group", { p_name, p_member_ids: [target.id] }),
    ).toBe("objectionable_content");
    const leftover = await withPg(async (pg) => {
      const { rows } = await pg.query<{ groups: number; members: number }>(
        `SELECT
           (SELECT count(*)::int FROM public.groups WHERE name = $1) AS groups,
           (SELECT count(*)::int FROM public.group_members WHERE user_id = $2) AS members`,
        [p_name, fresh.id],
      );
      return rows[0];
    });
    expect(leftover).toEqual({ groups: 0, members: 0 });

    const corrected = await client.rpc("update_profile", {
      p_name: "Ana Ok",
      p_handle: `ok_${fresh.id.replace(/-/g, "").slice(0, 20)}`,
    });
    expect(corrected.error).toBeNull();

    const created = await client.rpc("create_group", { p_name, p_member_ids: [target.id] });
    expect(created.error).toBeNull();
    const membership = await withPg(async (pg) => {
      const { rows } = await pg.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM public.groups g
           JOIN public.group_members gm ON gm.group_id = g.id
          WHERE g.name = $1 AND gm.user_id = $2`,
        [p_name, fresh.id],
      );
      return rows[0].count;
    });
    expect(membership).toBe(1);
  });

  it("refuses a slur in the display name or the handle when editing the profile", async () => {
    const { data, error } = await clientAlice.rpc("update_profile", { p_name: "Ana Souza" });
    expect(error).toBeNull();
    expect(data).toMatchObject({ name: "Ana Souza" });

    expect(await rpcErrorCode(clientAlice, "update_profile", { p_name: "Mongolóide" })).toBe(
      "objectionable_content",
    );
    expect(await rpcErrorCode(clientAlice, "update_profile", { p_handle: "ana_viado" })).toBe(
      "objectionable_content",
    );

    const readProfile = async () =>
      withPg(async (pg) => {
        const { rows } = await pg.query<{ name: string; handle: string }>(
          "SELECT name, handle FROM public.users WHERE id = $1",
          [alice.id],
        );
        return rows[0];
      });
    expect(await readProfile()).toEqual({ name: "Ana Souza", handle: alice.handle });

    const renamed = await clientAlice.rpc("update_profile", { p_name: "Ana de Souza" });
    expect(renamed.error).toBeNull();
    expect(await readProfile()).toEqual({ name: "Ana de Souza", handle: alice.handle });
  });

  it("refuses a profile write that would publish an objectionable inherited name until both fields are corrected", async () => {
    const fresh = await createTestUser({
      name: "Mongolóide",
      handle: `ana_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      onboarded: false,
    });
    const client = authenticateAs(fresh);
    const readProfile = async () =>
      withPg(async (pg) => {
        const { rows } = await pg.query<{ name: string; handle: string; onboarded: boolean }>(
          "SELECT name, handle, onboarded FROM public.users WHERE id = $1",
          [fresh.id],
        );
        return rows[0];
      });

    expect(await rpcErrorCode(client, "update_profile", {})).toBe("objectionable_content");
    expect(await rpcErrorCode(client, "update_profile", { p_name: null })).toBe(
      "objectionable_content",
    );
    expect(await readProfile()).toEqual({ name: "Mongolóide", handle: fresh.handle, onboarded: false });

    const p_handle = `ok_${fresh.id.replace(/-/g, "").slice(0, 20)}`;
    const corrected = await client.rpc("update_profile", { p_name: "Ana Ok", p_handle });
    expect(corrected.error).toBeNull();
    expect(await readProfile()).toEqual({ name: "Ana Ok", handle: p_handle, onboarded: true });
  });

  it("keeps an old rejected handle blocking profile writes until the handle is corrected too", async () => {
    const fresh = await createTestUser({
      name: "Mongolóide",
      handle: `mongoloide_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`,
      onboarded: false,
    });
    const client = authenticateAs(fresh);
    const readProfile = async () =>
      withPg(async (pg) => {
        const { rows } = await pg.query<{ name: string; handle: string; onboarded: boolean }>(
          "SELECT name, handle, onboarded FROM public.users WHERE id = $1",
          [fresh.id],
        );
        return rows[0];
      });

    expect(await rpcErrorCode(client, "update_profile", { p_name: "Ana Ok" })).toBe(
      "objectionable_content",
    );
    expect(await readProfile()).toEqual({ name: "Mongolóide", handle: fresh.handle, onboarded: false });

    const p_handle = `ok_${fresh.id.replace(/-/g, "").slice(0, 20)}`;
    const corrected = await client.rpc("update_profile", { p_name: "Ana Ok", p_handle });
    expect(corrected.error).toBeNull();
    expect(await readProfile()).toEqual({ name: "Ana Ok", handle: p_handle, onboarded: true });
  });

  it("allows the personal name Kike in profile fields and notification-only updates", async () => {
    const fresh = await createTestUser({});
    const client = authenticateAs(fresh);

    const renamed = await client.rpc("update_profile", { p_name: "Kike García" });
    expect(renamed.error).toBeNull();
    expect(renamed.data).toMatchObject({ name: "Kike García" });

    const p_handle = `kike_${fresh.id.replace(/-/g, "").slice(0, 20)}`;
    const rehandled = await client.rpc("update_profile", { p_handle });
    expect(rehandled.error).toBeNull();
    expect(rehandled.data).toMatchObject({ handle: p_handle });

    const preferences = { expenses: true, groups: false };
    const prefs = await client.rpc("update_profile", { p_notification_preferences: preferences });
    expect(prefs.error).toBeNull();
    expect(prefs.data).toMatchObject({ notificationPreferences: preferences });

    const stored = await withPg(async (pg) => {
      const { rows } = await pg.query<{
        name: string;
        handle: string;
        prefs: Record<string, boolean>;
      }>("SELECT name, handle, notification_preferences AS prefs FROM public.users WHERE id = $1", [
        fresh.id,
      ]);
      return rows[0];
    });
    expect(stored).toEqual({ name: "Kike García", handle: p_handle, prefs: preferences });
  });

  it("refuses a slur in the name or handle when completing onboarding, leaving the account unfinished", async () => {
    const fresh = await createTestUser({ onboarded: false });
    const client = authenticateAs(fresh);
    const base = {
      p_pix_key_encrypted: ENCRYPTED_PIX,
      p_pix_key_hint: "a***@b.com",
      p_pix_key_type: "email" as const,
    };
    expect(
      await rpcErrorCode(client, "complete_onboarding", { ...base, p_handle: "boiola_1", p_name: "Ana" }),
    ).toBe("objectionable_content");
    expect(
      await rpcErrorCode(client, "complete_onboarding", { ...base, p_handle: "ana_ok", p_name: "Retards" }),
    ).toBe("objectionable_content");
    const unfinished = await withPg(async (pg) => {
      const { rows } = await pg.query<{ name: string; handle: string; onboarded: boolean }>(
        "SELECT name, handle, onboarded FROM public.users WHERE id = $1",
        [fresh.id],
      );
      return rows[0];
    });
    expect(unfinished).toEqual({ name: fresh.name, handle: fresh.handle, onboarded: false });

    const p_handle = `ok_${fresh.id.replace(/-/g, "").slice(0, 20)}`;
    const completed = await client.rpc("complete_onboarding", {
      ...base,
      p_handle,
      p_name: "Ana Ok",
    });
    expect(completed.error).toBeNull();
    expect(completed.data).toMatchObject({ kind: "completed" });
    const account = await withPg(async (pg) => {
      const { rows } = await pg.query<{ name: string; handle: string; onboarded: boolean }>(
        "SELECT name, handle, onboarded FROM public.users WHERE id = $1",
        [fresh.id],
      );
      return rows[0];
    });
    expect(account).toEqual({ name: "Ana Ok", handle: p_handle, onboarded: true });
  });
});
