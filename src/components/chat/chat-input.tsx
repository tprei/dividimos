"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  ComposerDock,
  ComposerField,
  ComposerSendButton,
  isImeComposing,
} from "@/components/chat/composer";
import { haptics } from "@/hooks/use-haptics";

interface ChatInputProps {
  onSend: (content: string) => Promise<void>;
  onError?: (error: unknown) => void;
  disabled?: boolean;
  actions?: ReactNode;
}

export function ChatInput({ onSend, onError, disabled, actions }: ChatInputProps) {

  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = value.trim().length > 0 && !sending && !disabled;

  const resetHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, []);

  const handleSend = useCallback(async () => {
    // The field, not state, is the truth: an IME can still hold the last
    // characters in marked text that has not reached onChange yet.
    const trimmed = (textareaRef.current?.value ?? value).trim();
    if (!trimmed || sending || disabled) return;

    setSending(true);
    haptics.tap();
    try {
      await onSend(trimmed);
      setValue("");
      if (textareaRef.current) {
        textareaRef.current.value = "";
        textareaRef.current.style.height = "auto";
      }
    } catch (error) {
      onError?.(error);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [value, sending, disabled, onSend, onError]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !isImeComposing(e)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <ComposerDock>
      <ComposerField align="end">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            resetHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Mensagem..."
          disabled={disabled || sending}
          rows={1}
          aria-label="Mensagem"
          className="max-h-[120px] min-h-10 min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-base leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-50 md:text-sm"
        />
        {actions && value.length === 0 && <div className="flex shrink-0 items-center">{actions}</div>}
        <ComposerSendButton
          onClick={handleSend}
          disabled={!canSend}
          sending={sending}
          aria-label="Enviar mensagem"
        />
      </ComposerField>
    </ComposerDock>
  );
}
