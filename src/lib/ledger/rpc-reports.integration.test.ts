import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroup,
  createTestUsers,
  expectRpcError,
  getBalances,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

interface ConversationMessage {
  id: string;
  content: string | null;
  erased: boolean;
  senderId: string;
}

interface ReportRow {
  report_id: string;
  reason: string;
  details: string | null;
  message_snapshot: string | null;
  notified_at: string | null;
  reporter_handle: string;
  target_handle: string;
  group_name: string | null;
}

interface StoredReport {
  status: string;
  message_id: string | null;
  group_id: string | null;
  message_snapshot: string | null;
  details: string | null;
  notified_at: Date | null;
  resolved_at: Date | null;
  resolution_note: string | null;
}

type RpcResult<T> = { data: T | null; error: { message: string } | null };

interface Scene {
  host: TestUser;
  member: TestUser;
  invited: TestUser;
  former: TestUser;
  outsider: TestUser;
  groupId: string;
  messageId: string;
  messageText: string;
}

async function rpcOk<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = (await client.rpc(fn, args)) as RpcResult<T>;
  if (error) {
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return data as T;
}

async function send(
  user: TestUser,
  groupId: string,
  content: string,
): Promise<ConversationMessage> {
  return rpcOk<ConversationMessage>(authenticateAs(user), "send_message", {
    p_client_id: crypto.randomUUID(),
    p_group_id: groupId,
    p_content: content,
  });
}

async function serviceReport(args: {
  reporterId: string;
  targetUserId: string;
  reason?: string | null;
  messageId?: string | null;
  details?: string | null;
}): Promise<ReportRow[]> {
  return rpcOk<ReportRow[]>(adminClient as SupabaseClient, "report_content", {
    p_reporter_id: args.reporterId,
    p_target_user_id: args.targetUserId,
    p_reason: args.reason === undefined ? "assedio" : args.reason,
    ...(args.messageId == null ? {} : { p_message_id: args.messageId }),
    ...(args.details == null ? {} : { p_details: args.details }),
  });
}

async function serviceReportError(args: {
  reporterId?: string | null;
  targetUserId?: string | null;
  reason?: string | null;
  messageId?: string | null;
  details?: string | null;
}): Promise<string> {
  return expectRpcError(
    (adminClient as SupabaseClient).rpc("report_content", {
      p_reporter_id: args.reporterId ?? null,
      p_target_user_id: args.targetUserId ?? null,
      p_reason: args.reason ?? null,
      ...(args.messageId == null ? {} : { p_message_id: args.messageId }),
      ...(args.details == null ? {} : { p_details: args.details }),
    }),
  );
}

async function fetchReport(reportId: string): Promise<StoredReport> {
  return withPg(async (pg) => {
    const result = await pg.query<StoredReport>(
      "select status, message_id, group_id, message_snapshot, details, notified_at, resolved_at, resolution_note from public.reports where id = $1",
      [reportId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`report ${reportId} not found`);
    return row;
  });
}

async function reportCount(where: string, params: unknown[]): Promise<string> {
  return withPg(async (pg) => {
    const result = await pg.query<{ total: string }>(
      `select count(*)::text as total from public.reports where ${where}`,
      params,
    );
    return result.rows[0]?.total ?? "0";
  });
}

async function conversationOf(user: TestUser, groupId: string): Promise<ConversationMessage[]> {
  const envelope = await rpcOk<{ messages: ConversationMessage[] }>(
    authenticateAs(user),
    "get_conversation",
    { p_group_id: groupId, p_limit: 50 },
  );
  return envelope.messages;
}

async function createScene(): Promise<Scene> {
  const [host, member, invited, former, outsider] = await createTestUsers(5);
  const { groupId } = await createGroup(
    host,
    "Grupo denúncias",
    [member.id, invited.id, former.id],
  );
  await rpcOk<unknown>(authenticateAs(member), "accept_invitation", { p_group_id: groupId });
  await rpcOk<unknown>(authenticateAs(former), "accept_invitation", { p_group_id: groupId });
  const message = await send(host, groupId, "texto original da mensagem");
  await rpcOk<unknown>(authenticateAs(host), "remove_member", {
    p_group_id: groupId,
    p_user_id: former.id,
  });
  return { host, member, invited, former, outsider, groupId, messageId: message.id, messageText: "texto original da mensagem" };
}

describe.skipIf(!isIntegrationTestReady)("content reports", () => {
  let anonClient: SupabaseClient<Database>;
  let service: SupabaseClient;

  beforeAll(async () => {
    if (!adminClient) throw new Error("service role key missing");
    service = adminClient;
    anonClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  });

  describe("report_content", () => {
    it("snapshots another member's message and derives its group and sender", async () => {
      const scene = await createScene();
      const messagesBefore = await conversationOf(scene.member, scene.groupId);
      const balancesBefore = await getBalances(scene.groupId);

      const rows = await serviceReport({
        reporterId: scene.member.id,
        targetUserId: scene.host.id,
        reason: "ameaca_ou_violencia",
        messageId: scene.messageId,
        details: "  texto da denúncia  ",
      });

      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.report_id).toEqual(expect.any(String));
      expect(row.reason).toBe("ameaca_ou_violencia");
      expect(row.details).toBe("texto da denúncia");
      expect(row.message_snapshot).toBe(scene.messageText);
      expect(row.notified_at).toBeNull();
      expect(row.reporter_handle).toBe(scene.member.handle);
      expect(row.target_handle).toBe(scene.host.handle);
      expect(row.group_name).toBe("Grupo denúncias");

      const stored = await fetchReport(row.report_id);
      expect(stored.status).toBe("open");
      expect(stored.resolved_at).toBeNull();
      expect(stored.resolution_note).toBeNull();
      expect(stored.group_id).toBe(scene.groupId);

      expect(await conversationOf(scene.member, scene.groupId)).toEqual(messagesBefore);
      expect(await getBalances(scene.groupId)).toEqual(balancesBefore);
    });

    it("reports a user without requiring a shared group", async () => {
      const [reporter, target] = await createTestUsers(2);
      const rows = await serviceReport({
        reporterId: reporter.id,
        targetUserId: target.id,
        reason: "outro",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].message_snapshot).toBeNull();
      expect(rows[0].group_name).toBeNull();
      expect(rows[0].details).toBeNull();

      const stored = await fetchReport(rows[0].report_id);
      expect(stored.message_id).toBeNull();
      expect(stored.group_id).toBeNull();
      expect(stored.message_snapshot).toBeNull();
    });

    it("rejects anon and authenticated direct RPC and table access", async () => {
      const scene = await createScene();
      const base = {
        p_reporter_id: scene.member.id,
        p_target_user_id: scene.host.id,
        p_reason: "assedio",
        p_message_id: scene.messageId,
      };
      const expectDenied = async (
        call: PromiseLike<{ error: { code?: string; message: string } | null }>,
      ): Promise<void> => {
        const { error } = await call;
        expect(error?.code).toBe("42501");
        expect(error?.message).toMatch(/permission denied/i);
      };

      await expectDenied(anonClient.rpc("report_content", base));
      await expectDenied(authenticateAs(scene.member).rpc("report_content", base));
      await expectDenied(
        anonClient.rpc("mark_report_notified", { p_report_id: crypto.randomUUID() }),
      );
      await expectDenied(
        authenticateAs(scene.member).rpc("mark_report_notified", {
          p_report_id: crypto.randomUUID(),
        }),
      );
      await expectDenied(
        anonClient.rpc("resolve_report", {
          p_report_id: crypto.randomUUID(),
          p_status: "resolved",
          p_note: "nota",
        }),
      );
      await expectDenied(
        authenticateAs(scene.member).rpc("resolve_report", {
          p_report_id: crypto.randomUUID(),
          p_status: "resolved",
          p_note: "nota",
        }),
      );

      await expectDenied(anonClient.from("reports").select("*"));
      const authed = authenticateAs(scene.member).from("reports");
      await expectDenied(authed.select("*"));
      await expectDenied(
        authed.insert({
          reporter_id: scene.member.id,
          target_user_id: scene.host.id,
          reason: "assedio",
        }),
      );
      await expectDenied(authed.update({ status: "resolved" }).eq("id", crypto.randomUUID()));
      await expectDenied(authed.delete().eq("id", crypto.randomUUID()));

      await expect(
        reportCount("reporter_id = $1", [scene.member.id]),
      ).resolves.toBe("0");
    });

    it("rejects a missing or deleted reporter", async () => {
      const scene = await createScene();
      const base = { targetUserId: scene.host.id };

      expect(await serviceReportError({ reporterId: null, ...base })).toBe("unauthenticated");
      expect(
        await serviceReportError({ reporterId: crypto.randomUUID(), ...base }),
      ).toBe("unauthenticated");

      const [doomed] = await createTestUsers(1);
      await withPg(async (pg) => {
        await pg.query("update public.users set deleted_at = now() where id = $1", [doomed.id]);
      });
      expect(await serviceReportError({ reporterId: doomed.id, ...base })).toBe(
        "account_deleted",
      );
      await expect(
        reportCount("reporter_id = $1", [doomed.id]),
      ).resolves.toBe("0");
    });

    it("denies invited, former, and unrelated reporters access to a message", async () => {
      const scene = await createScene();
      for (const reporter of [scene.invited, scene.former, scene.outsider]) {
        expect(
          await serviceReportError({
            reporterId: reporter.id,
            targetUserId: scene.host.id,
            messageId: scene.messageId,
          }),
        ).toBe("not_a_member");
      }
    });

    it("rejects a missing message, missing target, self-report, and mismatched sender", async () => {
      const scene = await createScene();

      expect(
        await serviceReportError({
          reporterId: scene.member.id,
          targetUserId: scene.host.id,
          messageId: crypto.randomUUID(),
        }),
      ).toBe("message_not_found");
      expect(
        await serviceReportError({
          reporterId: scene.member.id,
          targetUserId: crypto.randomUUID(),
        }),
      ).toBe("user_not_found");
      expect(
        await serviceReportError({
          reporterId: scene.member.id,
          targetUserId: scene.member.id,
        }),
      ).toBe("invalid_argument");
      expect(
        await serviceReportError({
          reporterId: scene.member.id,
          targetUserId: scene.member.id,
          messageId: scene.messageId,
        }),
      ).toBe("invalid_argument");
      expect(
        await serviceReportError({
          reporterId: scene.member.id,
          targetUserId: scene.outsider.id,
          messageId: scene.messageId,
        }),
      ).toBe("invalid_argument");
      await expect(
        reportCount("reporter_id = $1 and message_id = $2", [scene.member.id, scene.messageId]),
      ).resolves.toBe("0");
    });

    it("validates report categories and Unicode detail bounds", async () => {
      const scene = await createScene();
      const reasons = [
        "assedio",
        "discurso_de_odio",
        "ameaca_ou_violencia",
        "conteudo_sexual",
        "golpe_ou_spam",
        "outro",
      ];
      for (const reason of reasons) {
        const message = await send(scene.host, scene.groupId, `motivo ${reason}`);
        const rows = await serviceReport({
          reporterId: scene.member.id,
          targetUserId: scene.host.id,
          reason,
          messageId: message.id,
        });
        expect(rows[0]?.reason).toBe(reason);
      }

      const unreported = { reporterId: scene.member.id, targetUserId: scene.outsider.id, reason: "outro" };
      expect(await serviceReportError({ ...unreported, reason: null })).toBe("invalid_argument");
      expect(await serviceReportError({ ...unreported, reason: "spamzao" })).toBe("invalid_argument");

      const blank = await serviceReport({ ...unreported, details: "   " });
      expect(blank[0]?.details).toBeNull();

      const [boundaryTarget] = await createTestUsers(1);
      const boundary = "😀".repeat(1000);
      const accepted = await serviceReport({
        reporterId: scene.member.id,
        targetUserId: boundaryTarget.id,
        reason: "outro",
        details: boundary,
      });
      expect(Array.from(accepted[0]?.details ?? "").length).toBe(1000);
      expect(
        await serviceReportError({
          reporterId: scene.member.id,
          targetUserId: boundaryTarget.id,
          reason: "outro",
          details: `${boundary}😀`,
        }),
      ).toBe("invalid_argument");
    });

    it("deduplicates concurrent message reports without overwriting initial evidence", async () => {
      const scene = await createScene();
      const base = {
        reporterId: scene.member.id,
        targetUserId: scene.host.id,
        messageId: scene.messageId,
      };

      const [first, second] = await Promise.all([
        serviceReport({ ...base, details: "detalhe da primeira tentativa" }),
        serviceReport({ ...base, details: "detalhe da segunda tentativa" }),
      ]);

      expect(first).toHaveLength(1);
      expect(second[0].report_id).toBe(first[0].report_id);
      expect(["detalhe da primeira tentativa", "detalhe da segunda tentativa"]).toContain(
        first[0].details,
      );
      expect(second[0].details).toBe(first[0].details);
      await expect(
        reportCount("reporter_id = $1 and message_id = $2", [scene.member.id, scene.messageId]),
      ).resolves.toBe("1");

      await rpcOk<unknown>(service, "erase_chat_message", { p_message_id: scene.messageId });
      const retry = await serviceReport({ ...base, details: "detalhe da terceira tentativa" });
      expect(retry[0].report_id).toBe(first[0].report_id);
      expect(retry[0].details).toBe(first[0].details);
      expect(retry[0].message_snapshot).toBe(scene.messageText);
    });

    it("creates a new report after the previous one is dismissed", async () => {
      const scene = await createScene();
      const base = {
        reporterId: scene.member.id,
        targetUserId: scene.host.id,
      };
      const first = await serviceReport({ ...base, reason: "assedio", messageId: scene.messageId });
      await rpcOk<null>(service, "resolve_report", {
        p_report_id: first[0].report_id,
        p_status: "dismissed",
        p_note: "Sem ação na primeira análise.",
      });

      const second = await serviceReport({ ...base, reason: "golpe_ou_spam", messageId: scene.messageId });
      expect(second[0].report_id).not.toBe(first[0].report_id);
      expect(second[0].reason).toBe("golpe_ou_spam");
      expect(second[0].details).toBeNull();
      await expect(
        reportCount("reporter_id = $1 and message_id = $2", [scene.member.id, scene.messageId]),
      ).resolves.toBe("2");
      await expect(
        reportCount("reporter_id = $1 and message_id = $2 and status = 'open'", [
          scene.member.id,
          scene.messageId,
        ]),
      ).resolves.toBe("1");

      const repeat = await serviceReport({ ...base, reason: "outro", messageId: scene.messageId });
      expect(repeat[0].report_id).toBe(second[0].report_id);
      expect(repeat[0].reason).toBe("golpe_ou_spam");
    });

    it("deduplicates user reports independently from message reports and other reporters", async () => {
      const scene = await createScene();
      const messageReport = await serviceReport({
        reporterId: scene.member.id,
        targetUserId: scene.host.id,
        messageId: scene.messageId,
      });
      const userReport = await serviceReport({
        reporterId: scene.member.id,
        targetUserId: scene.host.id,
        reason: "golpe_ou_spam",
      });
      expect(userReport[0].report_id).not.toBe(messageReport[0].report_id);

      const repeat = await serviceReport({
        reporterId: scene.member.id,
        targetUserId: scene.host.id,
        reason: "outro",
      });
      expect(repeat[0].report_id).toBe(userReport[0].report_id);
      expect(repeat[0].reason).toBe("golpe_ou_spam");

      const otherReporter = await serviceReport({
        reporterId: scene.outsider.id,
        targetUserId: scene.host.id,
        reason: "outro",
      });
      expect(otherReporter[0].report_id).not.toBe(userReport[0].report_id);
      await expect(reportCount("target_user_id = $1", [scene.host.id])).resolves.toBe("3");
    });

    it("accepts an already erased message without reconstructing text", async () => {
      const scene = await createScene();
      await rpcOk<unknown>(service, "erase_chat_message", { p_message_id: scene.messageId });

      const rows = await serviceReport({
        reporterId: scene.member.id,
        targetUserId: scene.host.id,
        messageId: scene.messageId,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].message_snapshot).toBeNull();
      expect(rows[0].group_name).toBe("Grupo denúncias");
    });

    it("retains report identity when the source message is physically removed", async () => {
      const scene = await createScene();
      const rows = await serviceReport({
        reporterId: scene.member.id,
        targetUserId: scene.host.id,
        messageId: scene.messageId,
      });
      const reportId = rows[0].report_id;

      await withPg(async (pg) => {
        await pg.query("delete from public.chat_messages where id = $1", [scene.messageId]);
      });
      const afterMessageDelete = await fetchReport(reportId);
      expect(afterMessageDelete.message_id).toBe(scene.messageId);
      expect(afterMessageDelete.group_id).toBe(scene.groupId);
      expect(afterMessageDelete.message_snapshot).toBe(scene.messageText);
      expect(
        await serviceReportError({
          reporterId: scene.member.id,
          targetUserId: scene.host.id,
          messageId: scene.messageId,
        }),
      ).toBe("message_not_found");

      await withPg(async (pg) => {
        await pg.query("delete from public.groups where id = $1", [scene.groupId]);
      });
      const afterGroupDelete = await fetchReport(reportId);
      expect(afterGroupDelete.message_id).toBe(scene.messageId);
      expect(afterGroupDelete.group_id).toBeNull();
      expect(afterGroupDelete.message_snapshot).toBe(scene.messageText);
    });
  });

  describe("report moderation", () => {
    it("records the first delivery receipt idempotently", async () => {
      const scene = await createScene();
      const reportId = (
        await serviceReport({
          reporterId: scene.member.id,
          targetUserId: scene.host.id,
          messageId: scene.messageId,
        })
      )[0].report_id;

      await rpcOk<null>(service, "mark_report_notified", { p_report_id: reportId });
      const firstAt = (await fetchReport(reportId)).notified_at;
      expect(firstAt).not.toBeNull();
      await rpcOk<null>(service, "mark_report_notified", { p_report_id: reportId });
      expect((await fetchReport(reportId)).notified_at?.getTime()).toBe(firstAt?.getTime());
    });

    it("rejects null and missing report ids for receipt and resolution", async () => {
      expect(
        await expectRpcError(
          service.rpc("mark_report_notified", { p_report_id: null }),
        ),
      ).toBe("invalid_argument");
      expect(
        await expectRpcError(
          service.rpc("mark_report_notified", { p_report_id: crypto.randomUUID() }),
        ),
      ).toBe("report_not_found");
      expect(
        await expectRpcError(
          service.rpc("resolve_report", {
            p_report_id: null,
            p_status: "resolved",
            p_note: "nota",
          }),
        ),
      ).toBe("invalid_argument");
      expect(
        await expectRpcError(
          service.rpc("resolve_report", {
            p_report_id: crypto.randomUUID(),
            p_status: "resolved",
            p_note: "nota",
          }),
        ),
      ).toBe("report_not_found");
    });

    it("resolves and dismisses reports with an operator note without changing delivery or chat", async () => {
      const scene = await createScene();
      const reportId = (
        await serviceReport({
          reporterId: scene.member.id,
          targetUserId: scene.host.id,
          messageId: scene.messageId,
        })
      )[0].report_id;
      await rpcOk<null>(service, "mark_report_notified", { p_report_id: reportId });
      const notifiedAt = (await fetchReport(reportId)).notified_at;

      await rpcOk<null>(service, "resolve_report", {
        p_report_id: reportId,
        p_status: "resolved",
        p_note: "Mensagem removida após revisão.",
      });
      const resolved = await fetchReport(reportId);
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution_note).toBe("Mensagem removida após revisão.");
      expect(resolved.resolved_at).not.toBeNull();
      expect((await fetchReport(reportId)).notified_at?.getTime()).toBe(notifiedAt?.getTime());

      await rpcOk<null>(service, "resolve_report", {
        p_report_id: reportId,
        p_status: "dismissed",
        p_note: "Revisão concluída sem ação.",
      });
      const dismissed = await fetchReport(reportId);
      expect(dismissed.status).toBe("dismissed");
      expect(dismissed.resolution_note).toBe("Revisão concluída sem ação.");
      expect(dismissed.resolved_at?.getTime()).toBeGreaterThanOrEqual(
        resolved.resolved_at?.getTime() ?? 0,
      );

      const messages = await conversationOf(scene.member, scene.groupId);
      expect(messages.find((m) => m.id === scene.messageId)?.content).toBe(scene.messageText);
    });

    it("rejects open or unknown resolution status and invalid note bounds", async () => {
      const scene = await createScene();
      const reportId = (
        await serviceReport({
          reporterId: scene.member.id,
          targetUserId: scene.host.id,
          messageId: scene.messageId,
        })
      )[0].report_id;
      const resolve = (p_status: unknown, p_note: unknown) =>
        expectRpcError(
          service.rpc("resolve_report", { p_report_id: reportId, p_status, p_note }),
        );

      expect(await resolve("open", "nota")).toBe("invalid_argument");
      expect(await resolve("closed", "nota")).toBe("invalid_argument");
      expect(await resolve(null, "nota")).toBe("invalid_argument");
      expect(await resolve("resolved", null)).toBe("invalid_argument");
      expect(await resolve("resolved", "   ")).toBe("invalid_argument");
      expect(await resolve("resolved", "a".repeat(2001))).toBe("invalid_argument");

      await rpcOk<null>(service, "resolve_report", {
        p_report_id: reportId,
        p_status: "resolved",
        p_note: "a".repeat(2000),
      });
      expect((await fetchReport(reportId)).status).toBe("resolved");
    });

    it("erases a reported message through the shared S2 RPC while retaining moderation evidence", async () => {
      const scene = await createScene();
      const reportId = (
        await serviceReport({
          reporterId: scene.member.id,
          targetUserId: scene.host.id,
          messageId: scene.messageId,
        })
      )[0].report_id;
      const balancesBefore = await getBalances(scene.groupId);

      const erased = await rpcOk<{ id: string; content: string | null; erased: boolean }>(
        service,
        "erase_chat_message",
        { p_message_id: scene.messageId },
      );
      expect(erased.id).toBe(scene.messageId);
      expect(erased.erased).toBe(true);
      expect(erased.content).toBeNull();

      const rendered = (await conversationOf(scene.member, scene.groupId)).find(
        (m) => m.id === scene.messageId,
      );
      expect(rendered?.erased).toBe(true);
      expect(rendered?.content).toBeNull();

      const evidence = await fetchReport(reportId);
      expect(evidence.status).toBe("open");
      expect(evidence.message_snapshot).toBe(scene.messageText);
      expect(await getBalances(scene.groupId)).toEqual(balancesBefore);
    });

    it("keeps report constraints active for service-role writes", async () => {
      const scene = await createScene();

      await expect(
        withPg(async (pg) => {
          await pg.query(
            "insert into public.reports (reporter_id, target_user_id, reason) values ($1, $1, 'assedio')",
            [scene.member.id],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        withPg(async (pg) => {
          await pg.query(
            "insert into public.reports (reporter_id, target_user_id, reason, details) values ($1, $2, 'assedio', $3)",
            [scene.member.id, scene.host.id, "x".repeat(1001)],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        withPg(async (pg) => {
          await pg.query(
            "insert into public.reports (reporter_id, target_user_id, reason, group_id) values ($1, $2, 'assedio', $3)",
            [scene.member.id, scene.host.id, scene.groupId],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });

      const reportId = (
        await serviceReport({
          reporterId: scene.member.id,
          targetUserId: scene.host.id,
          messageId: scene.messageId,
        })
      )[0].report_id;
      await expect(
        withPg(async (pg) => {
          await pg.query(
            "update public.reports set status = 'open', resolution_note = 'nota', resolved_at = now() where id = $1",
            [reportId],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        withPg(async (pg) => {
          await pg.query(
            "update public.reports set status = 'resolved', resolved_at = null, resolution_note = 'nota' where id = $1",
            [reportId],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });

      const stored = await fetchReport(reportId);
      expect(stored.status).toBe("open");
      expect(stored.resolution_note).toBeNull();
    });
  });
});
