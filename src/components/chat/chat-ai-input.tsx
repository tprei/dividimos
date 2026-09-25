"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui/icon-button";
import {
  ComposerDock,
  ComposerField,
  ComposerSendButton,
  isImeComposing,
} from "@/components/chat/composer";
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
    // The field, not state, is the truth: an IME can still hold the last
    // characters in marked text that has not reached onChange yet.
    const trimmed = (inputRef.current?.value ?? text).trim();
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
        if (inputRef.current) inputRef.current.value = "";
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
      if (e.key === "Enter" && !e.shiftKey && !isImeComposing(e)) {
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
    <ComposerDock>
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

      <ComposerField active={isAiMode}>
        <IconButton
          onClick={handleSparkleToggle}
          disabled={disabled}
          data-testid="sparkle-toggle"
          title={isAiMode ? "Modo IA ativo — pressione Esc para sair" : "Ativar IA para registrar conta"}
          className={cn(
            "rounded-full text-primary-text hover:text-primary-text",
            (isAiMode || hasDraft || isParsing) &&
              "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground dark:hover:bg-primary/90",
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

        <ComposerSendButton
          onClick={handleSubmit}
          disabled={disabled || isParsing || hasDraft || sending || !text.trim()}
          sending={sending}
          data-testid="send-button"
          aria-label={isAiMode ? "Registrar conta com IA" : "Enviar"}
        />
      </ComposerField>
    </ComposerDock>
  );
}
