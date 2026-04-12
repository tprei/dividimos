import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiExpenseParse } from "./use-ai-expense-parse";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

const mockResult: ChatExpenseResult = {
  title: "Uber",
  amountCents: 2500,
  expenseType: "single_amount",
  splitType: "equal",
  items: [],
  participants: [],
  payerHandle: "SELF",
  merchantName: null,
  confidence: "high",
};

describe("useAiExpenseParse", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with empty state", () => {
    const { result } = renderHook(() => useAiExpenseParse());
    expect(result.current.isParsing).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("sets isParsing while fetching and populates result on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAiExpenseParse());

    let parsePromise: Promise<void>;
    act(() => {
      parsePromise = result.current.parse("uber 25 eu paguei");
    });

    expect(result.current.isParsing).toBe(true);

    await act(async () => {
      await parsePromise;
    });

    expect(result.current.isParsing).toBe(false);
    expect(result.current.result).toEqual(mockResult);
    expect(result.current.error).toBeNull();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/parse",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "uber 25 eu paguei", members: undefined }),
      }),
    );
  });

  it("passes members to the API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAiExpenseParse());
    const members = [{ handle: "maria", name: "Maria" }];

    await act(async () => {
      await result.current.parse("pizza 60", members);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/parse",
      expect.objectContaining({
        body: JSON.stringify({ text: "pizza 60", members }),
      }),
    );
  });

  it("sets error when API returns non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Chat parser nao configurado" }),
      }),
    );

    const { result } = renderHook(() => useAiExpenseParse());

    await act(async () => {
      await result.current.parse("test");
    });

    expect(result.current.error).toBe("Chat parser nao configurado");
    expect(result.current.result).toBeNull();
  });

  it("sets fallback error when API returns no error field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      }),
    );

    const { result } = renderHook(() => useAiExpenseParse());

    await act(async () => {
      await result.current.parse("test");
    });

    expect(result.current.error).toBe("Erro ao processar mensagem");
  });

  it("clears state on reset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      }),
    );

    const { result } = renderHook(() => useAiExpenseParse());

    await act(async () => {
      await result.current.parse("test");
    });

    expect(result.current.result).toEqual(mockResult);

    act(() => {
      result.current.reset();
    });

    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isParsing).toBe(false);
  });

  it("ignores aborted requests", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const { result } = renderHook(() => useAiExpenseParse());

    await act(async () => {
      await result.current.parse("test");
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isParsing).toBe(false);
  });
});
