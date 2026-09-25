"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    const trimmed = value.trim();
    if (!trimmed || sending || disabled) return;

    setSending(true);
    haptics.tap();
    try {
      await onSend(trimmed);
      setValue("");
      if (textareaRef.current) {
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
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="shrink-0 bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="flex items-end gap-1 rounded-[0.75rem] border border-border bg-card p-1 focus-within:ring-3 focus-within:ring-ring/50">
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
          className="max-h-[120px] min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-50 md:text-sm"
        />
        {actions && value.length === 0 && <div className="flex shrink-0 items-center">{actions}</div>}
        <Button
          type="button"
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Enviar mensagem"
        >
          <Send />
        </Button>
      </div>
    </div>
  );
}
