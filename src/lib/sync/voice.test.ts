import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_AI_CONSENT_VERSION } from "@/lib/ai-consent";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import { useAppStore } from "@/stores/app-store";
import { parseVoiceExpenseCommand, transcribeVoiceAudio } from "./voice";

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

const result: VoiceExpenseResult = {
  title: "Uber",
  amountCents: 2500,
  expenseType: "single_amount",
  items: [],
  participants: [{ spokenName: "João", matchedHandle: "joao", confidence: "high" }],
  merchantName: null,
};

describe("parseVoiceExpenseCommand", () => {
  beforeEach(() => {
    seedUsableConsent();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useAppStore.getState().reset();
  });

  it("a 403 consent denial invalidates the local grant and throws ai_consent_required", async () => {
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

    await expect(parseVoiceExpenseCommand({ text: "uber 25" })).rejects.toMatchObject({
      code: "ai_consent_required",
    });

    const state = useAppStore.getState();
    expect(state.me?.aiConsentVersion).toBeNull();
    expect(state.me?.aiConsentGrantedAt).toBeNull();
    expect(state.aiConsentRevision).toBe(1);
  });

  it("missing consent means zero fetch calls", async () => {
    useAppStore.getState().patch((state) =>
      state.me
        ? { me: { ...state.me, aiConsentVersion: null, aiConsentGrantedAt: null } }
        : {},
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(parseVoiceExpenseCommand({ text: "uber 25" })).rejects.toMatchObject({
      code: "ai_consent_required",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a response pending after invalidation returns no usable result", async () => {
    const gate = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(gate.promise));

    const pending = parseVoiceExpenseCommand({ text: "uber 25" });
    useAppStore.getState().patch((s) =>
      s.me
        ? {
            me: { ...s.me, aiConsentVersion: null, aiConsentGrantedAt: null },
            aiConsentRevision: s.aiConsentRevision + 1,
          }
        : {},
    );
    gate.resolve(
      new Response(JSON.stringify({ title: "Uber", amountCents: 2500 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("POSTs the trimmed transcript and members and returns the parsed result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const members = [{ handle: "joao", name: "João Silva" }];
    await expect(
      parseVoiceExpenseCommand({ text: "uber com João 25 reais", members }),
    ).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/voice/parse");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      text: "uber com João 25 reais",
      members,
    });
  });

  it("throws the route's message on a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Texto muito curto" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(parseVoiceExpenseCommand({ text: "oi" })).rejects.toThrow(
      "Texto muito curto",
    );
  });

  it("falls back to the fixed message when the refusal body is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Server Error", { status: 500 })),
    );

    await expect(parseVoiceExpenseCommand({ text: "oi" })).rejects.toThrow(
      "Erro ao processar comando de voz",
    );
  });

  it("throws LedgerError(network) when offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await parseVoiceExpenseCommand({ text: "oi" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: "network" });
  });
});

describe("transcribeVoiceAudio", () => {
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

    await expect(
      transcribeVoiceAudio(new Blob(["x"]), new AbortController().signal),
    ).rejects.toMatchObject({ code: "ai_consent_required" });

    expect(useAppStore.getState().me?.aiConsentVersion).toBeNull();
  });

  it("a response pending after invalidation returns no usable transcript", async () => {
    const gate = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(gate.promise));

    const pending = transcribeVoiceAudio(new Blob(["x"]), new AbortController().signal);
    useAppStore.getState().patch((state) =>
      state.me
        ? {
            me: { ...state.me, aiConsentVersion: null, aiConsentGrantedAt: null },
            aiConsentRevision: state.aiConsentRevision + 1,
          }
        : {},
    );
    gate.resolve(
      new Response(JSON.stringify({ transcript: "Uber com João 25 reais" }), {
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

    await expect(
      transcribeVoiceAudio(new Blob(["x"]), new AbortController().signal),
    ).rejects.toMatchObject({ code: "ai_consent_required" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the blob as multipart form data and returns the transcript", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ transcript: "Uber com João 25 reais" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const blob = new Blob(["audio-bytes"], { type: "audio/mp4" });
    await expect(
      transcribeVoiceAudio(blob, controller.signal),
    ).resolves.toBe("Uber com João 25 reais");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/voice/transcribe");
    expect(init).toMatchObject({ method: "POST", signal: controller.signal });
    const form = init!.body as FormData;
    expect(form.get("audio")).toBeInstanceOf(Blob);
  });

  it("throws the route's message on a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Não ouvi nada. Tente de novo." }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      transcribeVoiceAudio(new Blob(["x"]), new AbortController().signal),
    ).rejects.toThrow("Não ouvi nada. Tente de novo.");
  });

  it("falls back to the fixed message when the refusal body is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Server Error", { status: 500 })),
    );

    await expect(
      transcribeVoiceAudio(new Blob(["x"]), new AbortController().signal),
    ).rejects.toThrow("Não foi possível transcrever o áudio");
  });

  it("throws LedgerError(network) when offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await transcribeVoiceAudio(
      new Blob(["x"]),
      new AbortController().signal,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "network" });
  });

  it("lets an aborted request pass through as AbortError", async () => {
    const abort = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    const error = await transcribeVoiceAudio(
      new Blob(["x"]),
      new AbortController().signal,
    ).catch((caught: unknown) => caught);
    expect((error as Error).name).toBe("AbortError");
  });

  it("throws LedgerError(invalid_wire) when the transcript is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ nope: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const error = await transcribeVoiceAudio(
      new Blob(["x"]),
      new AbortController().signal,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "invalid_wire" });
  });
});