"use client";

import { useCallback, useRef, useState } from "react";
import { parseChatExpenseMessage } from "@/lib/sync/chat-parse";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

export type { ChatExpenseResult };

export interface MemberContext {
  handle: string;
  name: string;
}

export interface UseAiExpenseParse {
  parse: (text: string, members?: MemberContext[]) => Promise<void>;
  isParsing: boolean;
  result: ChatExpenseResult | null;
  error: string | null;
  reset: () => void;
}

export function useAiExpenseParse(): UseAiExpenseParse {
  const [isParsing, setIsParsing] = useState(false);
  const [result, setResult] = useState<ChatExpenseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const parse = useCallback(
    async (text: string, members?: MemberContext[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsParsing(true);
      setError(null);
      setResult(null);

      try {
        const result = await parseChatExpenseMessage({
          text,
          members,
          signal: controller.signal,
        });
        setResult(result);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Erro ao processar mensagem",
        );
      } finally {
        setIsParsing(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setIsParsing(false);
    setResult(null);
    setError(null);
  }, []);

  return { parse, isParsing, result, error, reset };
}
