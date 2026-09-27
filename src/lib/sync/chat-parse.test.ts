import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_AI_CONSENT_VERSION } from "@/lib/ai-consent";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import { useAppStore } from "@/stores/app-store";
import { parseChatExpenseMessage } from "./chat-parse";

function seedUsableConsent(): void {
  useAppStore.getState().reset();
  useAppStore.setState({
    bootstrapStatus: "ready",
    lastBootstrappedAccountId: "user-a",
    lastBootstrappedGeneration: 0,
    me: {
      id: "user-a",
      handle: "user_a",
      name: "Alguém",
      avatarUrl: null,
      isBot: false,
      email: "user-a@example.com",
      pixKeyType: null,
      pixKeyHint: null,
      onboarded: true,
      notificationPreferences: {},
      aiConsentVersion: CURRENT_AI_CONSENT_VERSION,
      aiConsentGrantedAt: "2026-01-01T00:00:00.000Z",
    },
  });
}

const result: ChatExpenseResult = {

  title: "Pizza",
  amountCents: 6000,
  expenseType: "single_amount",
  splitType: "equal",
  allocations: [],
  items: [],
  confidence: "high",
  participants: [{ spokenName: "Maria", matchedHandle: "maria", confidence: "high" }],
  payerHandle: null,
  merchantName: null,
};

describe("parseChatExpenseMessage", () => {
  beforeEach(() => {
    seedUsableConsent();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useAppStore.getState().reset();
  });

  it("a 403 consent denial invalidates consent and throws ai_consent_required", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Para usar IA, permita o envio dos dados. Você pode continuar sem IA.",
            code: "ai_consent_required",
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(parseChatExpenseMessage({ text: "pizza 60" })).rejects.toMatchObject({
      code: "ai_consent_required",
    });

    expect(useAppStore.getState().me?.aiConsentVersion).toBeNull();
  });

  it("a response pending after invalidation returns no usable result", async () => {
    const gate = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(gate.promise));

    const pending = parseChatExpenseMessage({ text: "pizza 60" });
    useAppStore.getState().patch((state) =>
      state.me
        ? {
            me: { ...state.me, aiConsentVersion: null, aiConsentGrantedAt: null },
            aiConsentRevision: state.aiConsentRevision + 1,
          }
        : {},
    );
    gate.resolve(
      new Response(JSON.stringify({ title: "Pizza", amountCents: 6000 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("missing consent means zero fetch calls", async () => {
    useAppStore.getState().patch((state) =>
      state.me
        ? { me: { ...state.me, aiConsentVersion: null, aiConsentGrantedAt: null } }
        : {},
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(parseChatExpenseMessage({ text: "pizza 60" })).rejects.toMatchObject({
      code: "ai_consent_required",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the message and members with the abort signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const members = [{ handle: "maria", name: "Maria" }];
    await expect(
      parseChatExpenseMessage({ text: "pizza 60", members, signal: controller.signal }),
    ).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/parse");
    expect(init).toMatchObject({ method: "POST", signal: controller.signal });
    expect(JSON.parse(init!.body as string)).toEqual({ text: "pizza 60", members });
  });

  it("throws the route's message on a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Chat parser nao configurado" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(parseChatExpenseMessage({ text: "pizza" })).rejects.toThrow(
      "Chat parser nao configurado",
    );
  });

  it("falls back to the fixed message when the refusal carries no error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(parseChatExpenseMessage({ text: "pizza" })).rejects.toThrow(
      "Erro ao processar mensagem",
    );
  });

  it("throws LedgerError(network) when offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await parseChatExpenseMessage({ text: "pizza" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: "network" });
  });

  it("lets an abort propagate untouched", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(parseChatExpenseMessage({ text: "pizza" })).rejects.toBe(abortError);
  });
});