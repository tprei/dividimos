/**
 * Issue #475: route-to-real-RPC enforcement.
 *
 * This is an integration seam, not a paid external test — the Gemini
 * parser function is the only mocked boundary. The request-scoped Supabase
 * server client is mocked only to return the selected authenticated user
 * identity. `enforceRateLimit`, the admin RPC client, PostgREST, and the
 * real `increment_rate_limit` database function are all real and exercised
 * end to end.
 *
 * Module state (env stubs, vi.mock factories) is local to this file so
 * nothing leaks into another suite.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";

// server-only unconditionally throws outside a Next.js server bundle. This
// mocks the guard package itself (not business logic), matching the same
// pattern used by every other test that imports a "server-only" module
// (e.g. src/lib/rate-limit.test.ts).
vi.mock("server-only", () => ({}));

vi.stubEnv("RATE_LIMIT_DISABLED", "0");
vi.stubEnv("GEMINI_API_KEY", "ai-parse-rate-limit-test-key");

let currentUserId = "";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getClaims: () => Promise.resolve({ data: { claims: { sub: currentUserId } }, error: null }),
    },
  }),
}));

const mockParseChatExpense = vi.fn();
vi.mock("@/lib/chat-expense-parser", () => ({
  parseChatExpense: (...args: unknown[]) => mockParseChatExpense(...args),
}));

const mockParseVoiceExpense = vi.fn();
vi.mock("@/lib/voice-expense-parser", () => ({
  parseVoiceExpense: (...args: unknown[]) => mockParseVoiceExpense(...args),
}));

const { POST: chatParsePost } = await import("./chat/parse/route");
const { POST: voiceParsePost } = await import("./voice/parse/route");

function chatRequest(text = "pizza") {
  return new Request("http://localhost/api/chat/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

function voiceRequest(text = "pizza") {
  return new Request("http://localhost/api/voice/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

function freshUserId(): string {
  return crypto.randomUUID();
}

describe.skipIf(!isIntegrationTestReady)("chat/voice parse routes — real rate-limit RPC enforcement", () => {
  const seededSubjects: string[] = [];

  beforeAll(() => {
    mockParseChatExpense.mockResolvedValue({ title: "Test" });
    mockParseVoiceExpense.mockResolvedValue({ title: "Test" });
  });

  afterAll(async () => {
    if (!adminClient || seededSubjects.length === 0) return;
    await adminClient.from("rate_limit_counters").delete().in("subject", seededSubjects);
  });

  it("30 valid chat POSTs for user A succeed and invoke the chat parser 30 times; request 31 returns 429 with parser count pinned at 30", async () => {
    currentUserId = freshUserId();
    seededSubjects.push(currentUserId);
    mockParseChatExpense.mockClear();

    for (let i = 0; i < 30; i++) {
      const res = await chatParsePost(chatRequest());
      expect(res.status).toBe(200);
    }
    expect(mockParseChatExpense).toHaveBeenCalledTimes(30);

    const res31 = await chatParsePost(chatRequest());
    expect(res31.status).toBe(429);
    const body31 = await res31.json();
    expect(body31).toEqual({ error: "Muitas requisições. Tente novamente em alguns segundos." });
    expect(mockParseChatExpense).toHaveBeenCalledTimes(30);
  }, 30_000);

  it("a valid voice POST for the same exhausted chat user still succeeds, proving route-bucket isolation", async () => {
    // currentUserId is still the exhausted chat.parse user from the prior
    // test; voice.parse is a distinct bucket row for the same subject.
    mockParseVoiceExpense.mockClear();

    const res = await voiceParsePost(voiceRequest());
    expect(res.status).toBe(200);
    expect(mockParseVoiceExpense).toHaveBeenCalledTimes(1);
  });

  it("a valid chat POST for a different user B succeeds, proving subject isolation", async () => {
    currentUserId = freshUserId();
    seededSubjects.push(currentUserId);
    mockParseChatExpense.mockClear();

    const res = await chatParsePost(chatRequest());
    expect(res.status).toBe(200);
    expect(mockParseChatExpense).toHaveBeenCalledTimes(1);
  });

  it("31 concurrent valid chat POSTs on a fresh user/bucket produce exactly 30 successes, one 429, and 30 parser invocations", async () => {
    currentUserId = freshUserId();
    seededSubjects.push(currentUserId);
    mockParseChatExpense.mockClear();

    const responses = await Promise.all(
      Array.from({ length: 31 }, () => chatParsePost(chatRequest())),
    );
    const statuses = await Promise.all(
      responses.map(async (r) => ({ status: r.status, body: await r.json() })),
    );

    const successes = statuses.filter((s) => s.status === 200);
    const limited = statuses.filter((s) => s.status === 429);

    expect(successes).toHaveLength(30);
    expect(limited).toHaveLength(1);
    expect(limited[0]!.body).toEqual({ error: "Muitas requisições. Tente novamente em alguns segundos." });
    expect(mockParseChatExpense).toHaveBeenCalledTimes(30);
  }, 30_000);
});
