import { afterEach, describe, expect, it, vi } from "vitest";
import { parseVoiceExpenseCommand, transcribeVoiceAudio } from "./voice";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";

const result: VoiceExpenseResult = {
  title: "Uber",
  amountCents: 2500,
  expenseType: "single_amount",
  items: [],
  participants: [{ spokenName: "João", matchedHandle: "joao", confidence: "high" }],
  merchantName: null,
};

describe("parseVoiceExpenseCommand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
  afterEach(() => {
    vi.unstubAllGlobals();
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