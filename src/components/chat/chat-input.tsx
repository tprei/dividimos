"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import { Loader2, SendHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import type { MemberContext } from "@/lib/chat-expense-parser";

export interface ChatInputProps {
  groupId: string;
  members?: MemberContext[];
  disabled?: boolean;
  onSendText: (text: string) => Promise<void>;
  onAiResult: (result: ChatExpenseResult, originalText: string) => void;
}

type InputMode = "text" | "ai";

export function ChatInput({
  groupId,
  members,
  disabled,
  onSendText,
  onAiResult,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<InputMode>("text");
  const [sending, setSending] = useState(false);
  const [showAiHint, setShowAiHint] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !sending && !disabled;

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === "text" ? "ai" : "text";
      if (next === "ai") {
        setShowAiHint(true);
        setTimeout(() => setShowAiHint(false), 3000);
      }
      return next;
    });
    textareaRef.current?.focus();
  }, []);

  const resetInput = useCallback(() => {
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, []);

  const handleSendText = useCallback(async () => {
    if (!canSubmit) return;
    setSending(true);
    try {
      await onSendText(trimmed);
      resetInput();
    } finally {
      setSending(false);
    }
  }, [canSubmit, trimmed, onSendText, resetInput]);

  const handleAiParse = useCallback(async () => {
    if (!canSubmit) return;
    setSending(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          members: members ?? [],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Erro ao processar");
      }

      const result: ChatExpenseResult = await res.json();
      onAiResult(result, trimmed);
      resetInput();
      setMode("text");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[ChatInput] AI parse error:", err);
    } finally {
      if (!controller.signal.aborted) {
        setSending(false);
      }
    }
  }, [canSubmit, trimmed, members, onAiResult, resetInput]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (mode === "ai") {
        handleAiParse();
      } else {
        handleSendText();
      }
    },
    [mode, handleAiParse, handleSendText],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (mode === "ai") {
          handleAiParse();
        } else {
          handleSendText();
        }
      }
    },
    [mode, handleAiParse, handleSendText],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  return (
    <div className="border-t border-border/50 bg-background px-3 py-2">
      {showAiHint && mode === "ai" && (
        <div className="mb-2 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
          Descreva a despesa e a IA cria um rascunho para você. Ex: &quot;Uber 25 reais eu paguei&quot;
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex items-end gap-1.5">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              type="button"
              onClick={toggleMode}
              aria-label={
                mode === "ai"
                  ? "Desativar modo IA"
                  : "Ativar modo IA para criar despesa"
              }
              aria-pressed={mode === "ai"}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                mode === "ai"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Sparkles
                className={`h-5 w-5 ${mode === "ai" ? "animate-pulse" : ""}`}
              />
            </TooltipTrigger>
            <TooltipContent side="top">
              {mode === "ai"
                ? "Modo IA ativo — descreva a despesa"
                : "Criar despesa com IA"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div
          className={`flex min-h-[36px] flex-1 items-end rounded-2xl border px-3 py-1.5 transition-colors ${
            mode === "ai"
              ? "border-primary/40 bg-primary/5"
              : "border-border/50 bg-muted/30"
          }`}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={
              mode === "ai"
                ? "Ex: pizza 60 reais rachei com João..."
                : "Mensagem..."
            }
            disabled={sending || disabled}
            rows={1}
            className="max-h-[120px] w-full resize-none bg-transparent text-sm leading-5 outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        <Button
          type="submit"
          size="icon"
          variant={mode === "ai" ? "default" : "ghost"}
          disabled={!canSubmit}
          aria-label={mode === "ai" ? "Processar com IA" : "Enviar mensagem"}
          className="h-9 w-9 shrink-0 rounded-full"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <SendHorizontal className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
