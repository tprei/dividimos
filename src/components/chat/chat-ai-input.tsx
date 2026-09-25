"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Send, Sparkles } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ChatDraftCard, type ChatDraftStatus } from "@/components/chat/chat-draft-card";
import { cn } from "@/lib/utils";
import { useAiExpenseParse, type MemberContext } from "@/hooks/use-ai-expense-parse";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import { haptics } from "@/hooks/use-haptics";
import { popIn } from "@/lib/animations";

type InputMode = "normal" | "ai";

/** Explicit result so the input knows whether the text may be cleared. */
export type SendOutcome = { ok: true } | { ok: false; message: string };

interface ChatAiInputProps {
  groupId: string;
  members?: MemberContext[];
  onSend?: (text: string) => Promise<SendOutcome>;
  onConfirmDraft: (
    result: ChatExpenseResult,
  ) => Promise<{ expenseId: string } | { error: string }>;
  onEditDraft: (result: ChatExpenseResult) => void;
  disabled?: boolean;
  actions?: ReactNode;
}

export function ChatAiInput(props: ChatAiInputProps) {
  const { groupId, members, onSend, onConfirmDraft, onEditDraft, disabled = false, actions } = props;
  const [mode, setMode] = useState<InputMode>("normal");
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { parse, isParsing, result, error, reset } = useAiExpenseParse();

  const isAiMode = mode === "ai";
  const hasDraft = result !== null;
  const [confirmStatus, setConfirmStatus] = useState<ChatDraftStatus>("idle");
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const isConfirming = confirmStatus === "confirming";

  const handleSparkleToggle = useCallback(() => {
    if (isConfirming) return;
    if (hasDraft && !window.confirm("Descartar esta conta?")) return;
    if (hasDraft || isParsing) {
      reset();
      setText("");
      setMode("normal");
      setConfirmStatus("idle");
      setConfirmError(undefined);
      return;
    }
    setMode((prev) => (prev === "ai" ? "normal" : "ai"));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [hasDraft, isParsing, isConfirming, reset]);

  // Synchronous so a double submit cannot start two sends before React
  // re-renders with the pending state.
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Bumped on every edit: a success only clears text the user has not touched
  // since submitting.
  const editGenerationRef = useRef(0);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (isAiMode) {
      await parse(trimmed, members);
      setText("");
      return;
    }

    if (sendingRef.current || onSend === undefined) return;
    sendingRef.current = true;
    haptics.tap();
    const submittedGeneration = editGenerationRef.current;
    const submittedGroupId = groupId;
    setSending(true);
    setSendError(null);

    try {
      const outcome = await onSend(trimmed);
      if (!outcome.ok) {
        // The authored text stays exactly as typed so the send is retryable.
        setSendError(outcome.message);
        return;
      }
      if (
        editGenerationRef.current === submittedGeneration &&
        submittedGroupId === groupId
      ) {
        setText("");
      }
    } catch {
      setSendError("Não foi possível enviar. Tente novamente.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [text, isAiMode, parse, members, onSend, groupId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape" && isAiMode && !isConfirming) {
        if (hasDraft && !window.confirm("Descartar esta conta?")) return;
        setMode("normal");
        reset();
        setText("");
      }
    },
    [handleSubmit, isAiMode, isConfirming, hasDraft, reset],
  );

  const handleConfirm = useCallback(
    async (draft: ChatExpenseResult) => {
      setConfirmStatus("confirming");
      setConfirmError(undefined);
      const outcome = await onConfirmDraft(draft);
      if ("error" in outcome) {
        setConfirmStatus("error");
        setConfirmError(outcome.error);
        return;
      }
      setConfirmStatus("confirmed");
      haptics.success();
      reset();
      setText("");
      setMode("normal");
    },
    [onConfirmDraft, reset],
  );

  const handleEdit = useCallback(
    (draft: ChatExpenseResult) => {
      if (isConfirming) return;
      onEditDraft(draft);
      reset();
      setText("");
      setMode("normal");
    },
    [onEditDraft, reset, isConfirming],
  );

  return (
    <div className="shrink-0 space-y-2 bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <AnimatePresence mode="wait">
        {isParsing && (
          <motion.div
            key="parsing"
            variants={popIn} initial="hidden" animate="visible" exit="exit"
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
            variants={popIn} initial="hidden" animate="visible" exit="exit"
            className="max-h-[calc(var(--app-viewport-height,100dvh)*0.35)] overflow-y-auto overscroll-contain rounded-2xl"
          >
            <ChatDraftCard
              result={result}
              onConfirm={handleConfirm}
              onDiscard={() => {
                if (!window.confirm("Descartar esta conta?")) return;
                reset();
                setMode("normal");
              }}
              onEdit={handleEdit}
              status={confirmStatus}
              errorMessage={confirmError}
            />
          </motion.div>
        )}

        {error && !isParsing && !hasDraft && (
          <motion.div
            key="error"
            variants={popIn} initial="hidden" animate="visible" exit="exit"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive-text"
            data-testid="parse-error"
          >
            {error}
          </motion.div>
        )}

        {sendError !== null && (
          <motion.div
            key="send-error"
            variants={popIn} initial="hidden" animate="visible" exit="exit"
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive-text"
            data-testid="send-error"
          >
            {sendError}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          "flex items-center gap-1 rounded-[0.75rem] border border-border bg-card p-1 transition-colors focus-within:ring-3 focus-within:ring-ring/50",
          isAiMode && "border-primary/60",
        )}
      >
        <IconButton
          onClick={handleSparkleToggle}
          disabled={disabled}
          data-testid="sparkle-toggle"
          title={isAiMode ? "Modo IA ativo — pressione Esc para sair" : "Ativar IA para registrar conta"}
          className={cn(
            isAiMode || hasDraft || isParsing
              ? "bg-primary/15 text-primary-text hover:bg-primary/20 hover:text-primary-text"
              : "text-muted-foreground",
          )}
          aria-label={isAiMode ? "Desativar IA" : "Ativar IA para contas"}
          aria-pressed={isAiMode}
        >
          <Sparkles />
        </IconButton>

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => {
            editGenerationRef.current += 1;
            setSendError(null);
            setText(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled || isParsing || hasDraft}
          placeholder={
            isAiMode
              ? 'Ex.: "pizza 80 com João"'
              : "Mensagem…"
          }
          className="h-10 min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
          aria-label={isAiMode ? "Descrever conta com IA" : "Mensagem"}
          data-testid="chat-input"
        />

        {actions && !isAiMode && !hasDraft && !isParsing && text.length === 0 && (
          <div className="flex shrink-0 items-center">{actions}</div>
        )}

        <Button
          type="button"
          size="icon"
          onClick={handleSubmit}
          disabled={disabled || isParsing || hasDraft || sending || !text.trim()}
          data-testid="send-button"
          aria-label="Enviar"
        >
          {sending ? (
            <Loader2 className="animate-spin" />
          ) : isAiMode ? (
            <Sparkles />
          ) : (
            <Send />
          )}
        </Button>
      </div>
    </div>
  );
}
