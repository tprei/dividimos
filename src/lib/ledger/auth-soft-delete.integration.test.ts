import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import type { Database } from "@/types/database";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import { withPg } from "@/test/integration-helpers";

async function waitForProfile(
  pg: Client,
  userId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const profile = await pg.query("select 1 from public.users where id = $1", [userId]);
    if (profile.rowCount === 1) return;
    // The profile comes from an Auth database trigger on another connection;
    // poll until it lands instead of guessing a fixed delay.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("public profile was never created by the auth trigger");
}

describe.skipIf(!isIntegrationTestReady)("auth soft delete", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient<Database>;

  beforeAll(async () => {
    if (!adminClient) throw new Error("service role key missing");
    service = adminClient;
    anon = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  });

  it("keeps auth and public UUIDs while obfuscating auth identity and allowing email reuse", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `softdel_${suffix}@test.dividimos.local`;
    const password = `pw-${crypto.randomUUID()}`;

    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Soft Delete", handle: `softdel_${suffix}` },
    });
    if (created.error || !created.data.user) {
      throw new Error(`admin createUser failed: ${created.error?.message}`);
    }
    const authId = created.data.user.id;

    await withPg(async (pg) => {
      await waitForProfile(pg, authId);
    });

    await withPg(async (pg) => {
      const result = await pg.query(
        "update public.users set deleted_at = now() where id = $1",
        [authId],
      );
      if (result.rowCount !== 1) throw new Error("failed to mark the profile deleted");
    });

    const softDelete = await service.auth.admin.deleteUser(authId, true);
    expect(softDelete.error).toBeNull();

    const authRow = await withPg(async (pg) => {
      const user = await pg.query<{
        id: string;
        email: string | null;
        raw_user_meta_data: Record<string, unknown> | null;
        raw_app_meta_data: Record<string, unknown> | null;
      }>("select id, email, raw_user_meta_data, raw_app_meta_data from auth.users where id = $1", [authId]);
      const identities = await pg.query<{ provider: string; provider_id: string }>(
        "select provider, provider_id from auth.identities where user_id = $1",
        [authId],
      );
      const profile = await pg.query<{ deleted_at: string | null; name: string }>(
        "select deleted_at, name from public.users where id = $1",
        [authId],
      );
      return {
        user: user.rows[0] ?? null,
        identities: identities.rows,
        profile: profile.rows[0] ?? null,
      };
    });

    expect(authRow.user?.id).toBe(authId);
    expect(authRow.user?.email).not.toBe(email);
    expect(authRow.user?.raw_user_meta_data ?? {}).toEqual({});
    expect(authRow.user?.raw_app_meta_data ?? {}).toEqual({});
    expect(authRow.identities.every((identity) => identity.provider_id !== email)).toBe(true);
    expect(authRow.identities.every((identity) => identity.provider_id !== authId)).toBe(true);
    expect(authRow.profile?.deleted_at).not.toBeNull();

    const oldLogin = await anon.auth.signInWithPassword({ email, password });
    expect(oldLogin.data.session).toBeNull();
    expect(oldLogin.error).not.toBeNull();

    const reSignup = await anon.auth.signUp({ email, password });
    if (reSignup.error || !reSignup.data.user) {
      throw new Error(
        `soft delete blocked email reuse — S2 release gate failed: ${reSignup.error?.message}`,
      );
    }
    expect(reSignup.data.user.id).not.toBe(authId);

    await withPg(async (pg) => {
      await waitForProfile(pg, reSignup.data.user!.id);
      const profile = await pg.query<{ onboarded: boolean }>(
        "select onboarded from public.users where id = $1",
        [reSignup.data.user!.id],
      );
      expect(profile.rows[0]?.onboarded).toBe(false);
    });
  });

  it("repeating soft delete is harmless and foreign keys keep their rows", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const created = await service.auth.admin.createUser({
      email: `softdel2_${suffix}@test.dividimos.local`,
      password: `pw-${crypto.randomUUID()}`,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(`admin createUser failed: ${created.error?.message}`);
    }
    const authId = created.data.user.id;

    await withPg(async (pg) => {
      await waitForProfile(pg, authId);
    });

    const first = await service.auth.admin.deleteUser(authId, true);
    expect(first.error).toBeNull();
    const second = await service.auth.admin.deleteUser(authId, true);
    expect(second.error).toBeNull();

    const counts = await withPg(async (pg) => {
      const authUser = await pg.query("select 1 from auth.users where id = $1", [authId]);
      const publicUser = await pg.query("select 1 from public.users where id = $1", [authId]);
      return { auth: authUser.rowCount, public: publicUser.rowCount };
    });
    expect(counts.auth).toBe(1);
    expect(counts.public).toBe(1);
  });
});
