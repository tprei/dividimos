"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseChatExpenseMessage } from "@/lib/sync/chat-parse";
import {
  captureAiConsentAttempt,
  isAiConsentAttemptCurrent,
  type AiConsentAttempt,
} from "@/lib/sync/ai-consent";
import { useAppStore } from "@/stores/app-store";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

export type { ChatExpenseResult };

export interface MemberContext {
  handle: string;
  name: string;
}

export interface UseAiExpenseParse {
  /** Resolves true only when a current attempt published a parsed result. */
  parse: (text: string, members?: MemberContext[]) => Promise<boolean>;
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
  const attemptRef = useRef<AiConsentAttempt | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    attemptRef.current = null;
    setIsParsing(false);
    setResult(null);
    setError(null);
  }, []);

  // A consent revocation or account switch invalidates the captured attempt:
  // any in-flight parse is aborted and a published draft is discarded instead
  // of surviving into another account's composer.
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe(() => {
      const attempt = attemptRef.current;
      if (attempt !== null && !isAiConsentAttemptCurrent(attempt)) reset();
    });
    return unsubscribe;
  }, [reset]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      attemptRef.current = null;
    };
  }, []);

  const parse = useCallback(
    async (text: string, members?: MemberContext[]): Promise<boolean> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      let attempt: AiConsentAttempt;
      try {
        attempt = captureAiConsentAttempt();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Erro ao processar mensagem",
        );
        return false;
      }
      attemptRef.current = attempt;

      setIsParsing(true);
      setError(null);
      setResult(null);

      try {
        const parsed = await parseChatExpenseMessage({
          text,
          members,
          signal: controller.signal,
        });
        if (abortRef.current !== controller || !isAiConsentAttemptCurrent(attempt)) {
          return false;
        }
        setResult(parsed);
        return true;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return false;
        setError(
          err instanceof Error ? err.message : "Erro ao processar mensagem",
        );
        return false;
      } finally {
        if (abortRef.current === controller) setIsParsing(false);
      }
    },
    [],
  );

  return { parse, isParsing, result, error, reset };
}
