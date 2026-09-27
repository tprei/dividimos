import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { POST as reportsPost } from "./route";

vi.mock("server-only", () => ({}));

vi.stubEnv("RATE_LIMIT_DISABLED", "0");

let currentUserId = "";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getClaims: () => Promise.resolve({ data: { claims: { sub: currentUserId } }, error: null }),
    },
  }),
}));

const ALERT_TOKEN = "reports-route-test-bot-token";
const ALERT_CHAT = "424242";
const TELEGRAM_URL = "https://api.telegram.org/bot";

let telegramReply: (init?: RequestInit) => Response | Promise<Response> = () =>
  new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
let telegramFailure: Error | null = null;
let failReceiptRpc = false;
let failRateLimitRpc = false;
const telegramCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
const limitedSubjects: string[] = [];

const realFetch = globalThis.fetch;

async function fetchInterceptor(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (url.includes("api.telegram.org")) {
    if (telegramFailure) throw telegramFailure;
    telegramCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return telegramReply(init);
  }
  if (url.includes("/rest/v1/rpc/mark_report_notified") && failReceiptRpc) {
    return new Response(JSON.stringify({ message: "receipt rpc unavailable" }), { status: 500 });
  }
  if (url.includes("/rest/v1/rpc/increment_rate_limit") && failRateLimitRpc) {
    return new Response(JSON.stringify({ message: "rate limit rpc unavailable" }), { status: 500 });
  }
  return realFetch(input, init);
}

interface ChatMessage {
  id: string;
  clientId: string;
}

async function rpcOk<T>(
  client: SupabaseClient<Database>,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = (await client.rpc(fn as never, args as never)) as {
    data: T | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

async function send(host: TestUser, groupId: string, content: string): Promise<ChatMessage> {
  return rpcOk<ChatMessage>(authenticateAs(host), "send_message", {
    p_client_id: crypto.randomUUID(),
    p_group_id: groupId,
    p_content: content,
  });
}

function reportRequest(body: unknown): Request {
  return new Request("http://localhost/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
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

async function receiptOf(reporterId: string): Promise<Date | null> {
  return withPg(async (pg) => {
    const result = await pg.query<{ notified_at: Date | null }>(
      "select notified_at from public.reports where reporter_id = $1",
      [reporterId],
    );
    return result.rows[0]?.notified_at ?? null;
  });
}

interface Scene {
  host: TestUser;
  member: TestUser;
  outsider: TestUser;
  groupId: string;
  messageId: string;
}

async function createScene(messageText = "mensagem denunciável da rota"): Promise<Scene> {
  const [host, member, outsider] = await createTestUsers(3);
  const groupId = await createGroupWithMembers(host, [member], "Grupo rota denúncias");
  const message = await send(host, groupId, messageText);
  return { host, member, outsider, groupId, messageId: message.id };
}

function counterCount(subject: string): Promise<string> {
  return withPg(async (pg) => {
    const result = await pg.query<{ total: string }>(
      "select count::text as total from public.rate_limit_counters where bucket = 'reports.create' and subject = $1",
      [subject],
    );
    return result.rows[0]?.total ?? "0";
  });
}

describe.skipIf(!isIntegrationTestReady)("reports route — real RPCs against local PostgREST", () => {
  beforeAll(() => {
    vi.stubEnv("ALERT_TELEGRAM_BOT_TOKEN", ALERT_TOKEN);
    vi.stubEnv("ALERT_TELEGRAM_CHAT_ID", ALERT_CHAT);
    globalThis.fetch = fetchInterceptor as typeof fetch;
  });

  afterEach(async () => {
    telegramCalls.length = 0;
    telegramReply = () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    telegramFailure = null;
    failReceiptRpc = false;
    failRateLimitRpc = false;
    vi.stubEnv("ALERT_TELEGRAM_BOT_TOKEN", ALERT_TOKEN);
    vi.stubEnv("ALERT_TELEGRAM_CHAT_ID", ALERT_CHAT);
    await withPg(async (pg) => {
      await pg.query("delete from public.rate_limit_counters where bucket = 'reports.create'");
    });
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
    if (!adminClient || limitedSubjects.length === 0) return;
    await adminClient.from("rate_limit_counters").delete().in("subject", limitedSubjects);
  });

  it("stores and delivers a message report before returning success", async () => {
    const scene = await createScene();
    currentUserId = scene.member.id;

    const res = await reportsPost(reportRequest({
      targetUserId: scene.host.id,
      messageId: scene.messageId,
      reason: "ameaca_ou_violencia",
      details: "detalhes com <b>marcação</b> literal e *asterisco*",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["delivered", "reportId"]);
    expect(body.delivered).toBe(true);
    expect(body.reportId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    expect(telegramCalls).toHaveLength(1);
    expect(telegramCalls[0].url).toBe(`${TELEGRAM_URL}${ALERT_TOKEN}/sendMessage`);
    expect(telegramCalls[0].body.chat_id).toBe(ALERT_CHAT);
    expect(telegramCalls[0].body).not.toHaveProperty("parse_mode");
    const text = String(telegramCalls[0].body.text);
    expect(text).toContain(`Quem denunciou: ${scene.member.handle}`);
    expect(text).toContain(`Pessoa denunciada: ${scene.host.handle}`);
    expect(text).not.toContain(`@${scene.member.handle}`);
    expect(text).toContain("detalhes com <b>marcação</b> literal e *asterisco*");
    expect(text).toContain("Grupo rota denúncias");
    expect(text).toContain("mensagem denunciável da rota");
    expect(text).toContain("Ameaça ou violência");
    expect(text.length).toBeLessThan(4096);

    expect(await receiptOf(scene.member.id)).not.toBeNull();
  }, 30_000);

  it("passes an abort signal and times out a hanging Telegram fetch", async () => {
    const scene = await createScene();
    currentUserId = scene.member.id;
    let observedSignal: unknown = null;
    telegramReply = (init) => {
      observedSignal = init?.signal;
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        return Promise.reject(new Error("fetch called without an abort signal"));
      }
      const { promise, reject } = Promise.withResolvers<Response>();
      signal.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
      return promise;
    };

    vi.useFakeTimers();
    try {
      const pending = reportsPost(reportRequest({
        targetUserId: scene.host.id,
        messageId: scene.messageId,
        reason: "assedio",
      }));
      await vi.advanceTimersByTimeAsync(10_001);
      const res = await pending;
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("report_delivery_failed");
    } finally {
      vi.useRealTimers();
    }
    expect(observedSignal instanceof AbortSignal).toBe(true);
    expect(await receiptOf(scene.member.id)).toBeNull();
  }, 30_000);

  it("does not trust a body-provided reporter or snapshot", async () => {
    const scene = await createScene();
    currentUserId = scene.member.id;

    const res = await reportsPost(reportRequest({
      targetUserId: scene.host.id,
      messageId: scene.messageId,
      reason: "assedio",
      reporterId: scene.outsider.id,
      reporter_id: scene.outsider.id,
      groupId: scene.groupId,
      messageSnapshot: "texto forjado",
      message_snapshot: "texto forjado",
    }));

    expect(res.status).toBe(200);
    const stored = await withPg(async (pg) => {
      const result = await pg.query<{
        reporter_id: string;
        message_snapshot: string | null;
        group_id: string | null;
      }>(
        "select reporter_id, message_snapshot, group_id from public.reports where reporter_id = $1",
        [scene.member.id],
      );
      return result.rows[0];
    });
    expect(stored?.reporter_id).toBe(scene.member.id);
    expect(stored?.message_snapshot).toBe("mensagem denunciável da rota");
    expect(stored?.group_id).toBe(scene.groupId);
  }, 30_000);

  it("rejects missing session and invalid request bodies before storing or delivering", async () => {
    const scene = await createScene();

    currentUserId = "";
    const unauthorized = await reportsPost(reportRequest({
      targetUserId: scene.host.id,
      reason: "assedio",
    }));
    expect(unauthorized.status).toBe(401);
    expect((await unauthorized.json()).error.code).toBe("unauthenticated");

    currentUserId = scene.member.id;
    const cases: Array<{ label: string; body: unknown }> = [
      { label: "malformed json", body: "{not-json" },
      { label: "non-object", body: 42 },
      { label: "invalid target uuid", body: { targetUserId: "nope", reason: "assedio" } },
      { label: "unknown reason", body: { targetUserId: scene.host.id, reason: "spamzao" } },
      { label: "invalid details type", body: { targetUserId: scene.host.id, reason: "assedio", details: 42 } },
      { label: "excessive details", body: { targetUserId: scene.host.id, reason: "assedio", details: "x".repeat(1001) } },
    ];
    for (const testCase of cases) {
      const res = await reportsPost(reportRequest(testCase.body));
      expect(res.status, testCase.label).toBe(400);
      expect((await res.json()).error.code, testCase.label).toBe("invalid_argument");
    }

    expect(telegramCalls).toHaveLength(0);
    await expect(reportCount("target_user_id = $1", [scene.host.id])).resolves.toBe("0");
  }, 30_000);

  it("returns membership denial without contacting Telegram", async () => {
    const scene = await createScene();
    currentUserId = scene.outsider.id;

    const res = await reportsPost(reportRequest({
      targetUserId: scene.host.id,
      messageId: scene.messageId,
      reason: "assedio",
    }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("not_a_member");
    expect(telegramCalls).toHaveLength(0);
    await expect(reportCount("reporter_id = $1", [scene.outsider.id])).resolves.toBe("0");
  }, 30_000);

  it("keeps undelivered reports retryable and uses the same row", async () => {
    const scene = await createScene();
    currentUserId = scene.member.id;
    const request = () =>
      reportRequest({
        targetUserId: scene.host.id,
        messageId: scene.messageId,
        reason: "assedio",
      });

    telegramReply = () => new Response("gateway exploded", { status: 502 });
    const failed = await reportsPost(request());
    expect(failed.status).toBe(503);
    expect((await failed.json()).error.code).toBe("report_delivery_failed");
    expect(await receiptOf(scene.member.id)).toBeNull();

    telegramReply = () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    const retry = await reportsPost(request());
    expect(retry.status).toBe(200);
    const body = await retry.json();
    const stored = await withPg(async (pg) => {
      const result = await pg.query<{ id: string; notified_at: Date | null }>(
        "select id, notified_at from public.reports where reporter_id = $1",
        [scene.member.id],
      );
      return result.rows[0];
    });
    expect(body.reportId).toBe(stored?.id);
    expect(stored?.notified_at).not.toBeNull();
    await expect(reportCount("reporter_id = $1", [scene.member.id])).resolves.toBe("1");
  }, 30_000);

  it("does not resend an already delivered duplicate", async () => {
    const scene = await createScene();
    currentUserId = scene.member.id;
    const request = () =>
      reportRequest({
        targetUserId: scene.host.id,
        messageId: scene.messageId,
        reason: "assedio",
      });

    const first = await reportsPost(request());
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(telegramCalls).toHaveLength(1);

    const repeat = await reportsPost(request());
    expect(repeat.status).toBe(200);
    expect((await repeat.json()).reportId).toBe(firstBody.reportId);
    expect(telegramCalls).toHaveLength(1);
  }, 30_000);

  it("requires explicit Telegram acceptance and fails closed when unconfigured", async () => {
    const outcomes: Array<{ label: string; reply?: () => Response; failure?: Error; unconfigured?: boolean }> = [
      { label: "non-2xx", reply: () => new Response(JSON.stringify({ ok: true }), { status: 502 }) },
      { label: "ok false", reply: () => new Response(JSON.stringify({ ok: false }), { status: 200 }) },
      { label: "missing ok", reply: () => new Response(JSON.stringify({ result: {} }), { status: 200 }) },
      { label: "malformed json", reply: () => new Response("not-json", { status: 200 }) },
      { label: "network failure", failure: new Error("connection reset") },
      { label: "timeout rejection", failure: new DOMException("The operation was aborted.", "AbortError") },
      { label: "missing configuration", unconfigured: true },
    ];

    for (const outcome of outcomes) {
      const scene = await createScene();
      currentUserId = scene.member.id;
      if (outcome.reply) telegramReply = outcome.reply;
      if (outcome.failure) telegramFailure = outcome.failure;
      if (outcome.unconfigured) {
        vi.stubEnv("ALERT_TELEGRAM_BOT_TOKEN", "");
        vi.stubEnv("ALERT_TELEGRAM_CHAT_ID", "");
      }

      const res = await reportsPost(reportRequest({
        targetUserId: scene.host.id,
        messageId: scene.messageId,
        reason: "assedio",
      }));

      expect(res.status, outcome.label).toBe(503);
      expect((await res.json()).error.code, outcome.label).toBe("report_delivery_failed");
      expect(await receiptOf(scene.member.id), outcome.label).toBeNull();

      telegramReply = () =>
        new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      telegramFailure = null;
    }
  }, 60_000);

  it("returns retryable failure if receipt persistence fails after acceptance", async () => {
    const scene = await createScene();
    currentUserId = scene.member.id;
    const request = () =>
      reportRequest({
        targetUserId: scene.host.id,
        messageId: scene.messageId,
        reason: "assedio",
      });

    failReceiptRpc = true;
    const failed = await reportsPost(request());
    expect(failed.status).toBe(503);
    expect((await failed.json()).error.code).toBe("report_delivery_failed");
    expect(await receiptOf(scene.member.id)).toBeNull();
    expect(await reportCount("reporter_id = $1", [scene.member.id])).toBe("1");
    expect(telegramCalls).toHaveLength(1);

    failReceiptRpc = false;
    const retry = await reportsPost(request());
    expect(retry.status).toBe(200);
    const body = await retry.json();
    const stored = await withPg(async (pg) => {
      const result = await pg.query<{ id: string; notified_at: Date | null }>(
        "select id, notified_at from public.reports where reporter_id = $1",
        [scene.member.id],
      );
      return result.rows[0];
    });
    expect(body.reportId).toBe(stored?.id);
    expect(stored?.notified_at).not.toBeNull();
  }, 30_000);

  it("limits a reporter to five attempts per minute without affecting another reporter", async () => {
    const scene = await createScene();
    currentUserId = scene.member.id;
    const request = () =>
      reportRequest({
        targetUserId: scene.host.id,
        messageId: scene.messageId,
        reason: "assedio",
      });
    limitedSubjects.push(scene.member.id, scene.outsider.id);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await reportsPost(request());
      expect(res.status, `attempt ${attempt + 1}`).toBe(200);
    }
    expect(telegramCalls).toHaveLength(1);

    const sixth = await reportsPost(request());
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.code).toBe("report_rate_limited");
    expect(telegramCalls).toHaveLength(1);
    expect(await reportCount("reporter_id = $1", [scene.member.id])).toBe("1");
    expect(await counterCount(scene.member.id)).toBe("6");

    const [otherMember] = await createTestUsers(1);
    limitedSubjects.push(otherMember.id);
    await rpcOk<unknown>(authenticateAs(scene.host), "invite_member", {
      p_group_id: scene.groupId,
      p_user_id: otherMember.id,
    });
    await rpcOk<unknown>(authenticateAs(otherMember), "accept_invitation", {
      p_group_id: scene.groupId,
    });
    currentUserId = otherMember.id;
    const other = await reportsPost(reportRequest({
      targetUserId: scene.host.id,
      messageId: scene.messageId,
      reason: "assedio",
    }));
    expect(other.status).toBe(200);
    expect(await counterCount(otherMember.id)).toBe("1");
  }, 60_000);

  it("refuses to store or deliver when the rate limiter is unavailable", async () => {
    const scene = await createScene();
    currentUserId = scene.member.id;
    failRateLimitRpc = true;

    const res = await reportsPost(reportRequest({
      targetUserId: scene.host.id,
      messageId: scene.messageId,
      reason: "assedio",
    }));

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("report_rate_limit_unavailable");
    expect(telegramCalls).toHaveLength(0);
    await expect(reportCount("reporter_id = $1", [scene.member.id])).resolves.toBe("0");
  }, 30_000);
});
