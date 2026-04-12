"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Send, Sparkles } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChatDraftCard } from "@/components/chat/chat-draft-card";
import { cn } from "@/lib/utils";
import { useAiExpenseParse, type MemberContext } from "@/hooks/use-ai-expense-parse";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

type InputMode = "normal" | "ai";

interface ChatAiInputProps {
  groupId: string;
  members?: MemberContext[];
  onSend?: (text: string) => void;
  onConfirmDraft: (result: ChatExpenseResult) => void;
  onEditDraft: (result: ChatExpenseResult) => void;
  disabled?: boolean;
}

export function ChatAiInput(props: ChatAiInputProps) {
  const { members, onSend, onConfirmDraft, onEditDraft, disabled = false } = props;
  const [mode, setMode] = useState<InputMode>("normal");
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { parse, isParsing, result, error, reset } = useAiExpenseParse();

  const isAiMode = mode === "ai";
  const hasDraft = result !== null;

  const handleSparkleToggle = useCallback(() => {
    if (hasDraft || isParsing) {
      reset();
      setText("");
      setMode("normal");
      return;
    }
    setMode((prev) => (prev === "ai" ? "normal" : "ai"));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [hasDraft, isParsing, reset]);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (isAiMode) {
      await parse(trimmed, members);
      setText("");
      return;
    }

    onSend?.(trimmed);
    setText("");
  }, [text, isAiMode, parse, members, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape" && isAiMode) {
        setMode("normal");
        reset();
        setText("");
      }
    },
    [handleSubmit, isAiMode, reset],
  );

  const handleConfirm = useCallback(
    (draft: ChatExpenseResult) => {
      onConfirmDraft(draft);
      reset();
      setText("");
      setMode("normal");
    },
    [onConfirmDraft, reset],
  );

  const handleEdit = useCallback(
    (draft: ChatExpenseResult) => {
      onEditDraft(draft);
      reset();
      setText("");
      setMode("normal");
    },
    [onEditDraft, reset],
  );

  return (
    <div className="space-y-3">
      <AnimatePresence mode="wait">
        {isParsing && (
          <motion.div
            key="parsing"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="rounded-2xl border bg-card p-4"
            data-testid="parsing-skeleton"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
              <div className="space-y-1.5">
                <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              </div>
            </div>
          </motion.div>
        )}

        {hasDraft && !isParsing && (
          <motion.div
            key="draft"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <ChatDraftCard
              result={result}
              onConfirm={handleConfirm}
              onEdit={handleEdit}
            />
          </motion.div>
        )}

        {error && !isParsing && !hasDraft && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive"
            data-testid="parse-error"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          "flex items-center gap-2 rounded-2xl border bg-background px-3 py-2 transition-colors",
          isAiMode && "border-primary/60 ring-1 ring-primary/20",
        )}
      >
        <button
          type="button"
          onClick={handleSparkleToggle}
          disabled={disabled}
          data-testid="sparkle-toggle"
          title={isAiMode ? "Modo IA ativo — pressione Esc para sair" : "Ativar IA para registrar despesa"}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
            isAiMode || hasDraft || isParsing
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          aria-label={isAiMode ? "Desativar IA" : "Ativar IA para despesas"}
          aria-pressed={isAiMode}
        >
          <Sparkles className="h-4 w-4" />
        </button>

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isParsing || hasDraft}
          placeholder={
            isAiMode
              ? "Descreva a despesa (ex: 'uber 25 eu paguei')"
              : "Mensagem…"
          }
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="chat-input"
        />

        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={handleSubmit}
          disabled={disabled || isParsing || hasDraft || !text.trim()}
          data-testid="send-button"
          aria-label="Enviar"
        >
          {isAiMode ? (
            <Sparkles className="h-4 w-4 text-primary" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
