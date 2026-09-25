import { afterEach, describe, expect, it, vi } from "vitest";
import { parseChatExpenseMessage } from "./chat-parse";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

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
  afterEach(() => {
    vi.unstubAllGlobals();
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