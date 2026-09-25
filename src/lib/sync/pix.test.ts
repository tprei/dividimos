import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePixCode, generateSelfPixCode, PixRequestError } from "./pix";
import { LedgerError } from "./errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("generatePixCode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the payment details to /api/pix/generate and returns the code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { copiaECola: "00020126" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generatePixCode({ recipientUserId: "u2", amountCents: 5000, groupId: "g1" }),
    ).resolves.toBe("00020126");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pix/generate");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      recipientUserId: "u2",
      amountCents: 5000,
      groupId: "g1",
    });
  });

  it("forwards the abort signal so the caller can cancel", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal);
      return Promise.resolve(jsonResponse(200, { copiaECola: "x" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await generatePixCode({
      recipientUserId: "u2",
      amountCents: 1,
      groupId: "g1",
      signal: controller.signal,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("surfaces each refusal status for the caller to map", async () => {
    for (const [status, body] of [
      [400, { error: "Dados inválidos" }],
      [401, { error: "Não autenticado" }],
      [403, { error: "Acesso negado" }],
      [404, { error: "Destinatario sem chave Pix configurada" }],
      [429, { error: "Muitas requisições. Tente novamente em alguns segundos." }],
      [500, { error: "Erro ao processar sua chave Pix" }],
    ] as const) {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, body));
      vi.stubGlobal("fetch", fetchMock);

      const error = await generatePixCode({
        recipientUserId: "u2",
        amountCents: 1,
        groupId: "g1",
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(PixRequestError);
      expect((error as PixRequestError).status).toBe(status);
      expect((error as PixRequestError).message).toBe(body.error);
    }
  });

  it("keeps the status when the refusal body is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("gateway html", { status: 502 })),
    );

    const error = await generatePixCode({
      recipientUserId: "u2",
      amountCents: 1,
      groupId: "g1",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PixRequestError);
    expect((error as PixRequestError).status).toBe(502);
  });

  it("rejects a 200 whose body carries no code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));

    const error = await generatePixCode({
      recipientUserId: "u2",
      amountCents: 1,
      groupId: "g1",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PixRequestError);
    expect((error as PixRequestError).status).toBe(200);
  });

  it("throws LedgerError(network) when the transport fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(
      generatePixCode({ recipientUserId: "u2", amountCents: 1, groupId: "g1" }),
    ).rejects.toMatchObject({ code: "network" });
  });

  it("lets an abort propagate untouched", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(
      generatePixCode({ recipientUserId: "u2", amountCents: 1, groupId: "g1" }),
    ).rejects.toBe(abortError);
  });
});

describe("generateSelfPixCode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the amount to /api/pix/generate-self and returns the code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { copiaECola: "self-br-code" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateSelfPixCode({ amountCents: 2000 })).resolves.toBe("self-br-code");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pix/generate-self");
    expect(JSON.parse(init!.body as string)).toEqual({ amountCents: 2000 });
  });

  it("carries the refusal message from the route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(404, { error: "Voce nao tem chave Pix configurada" })),
    );

    const error = await generateSelfPixCode({ amountCents: 2000 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(PixRequestError);
    expect((error as PixRequestError).status).toBe(404);
    expect((error as PixRequestError).message).toBe("Voce nao tem chave Pix configurada");
  });

  it("is a LedgerError when offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    const error = await generateSelfPixCode({ amountCents: 2000 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(LedgerError);
    expect((error as LedgerError).code).toBe("network");
  });
});