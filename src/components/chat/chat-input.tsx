"use client";

import { Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { sendChatMessage } from "@/lib/supabase/chat-actions";

interface ChatInputProps {
  groupId: string;
}

export function ChatInput({ groupId }: ChatInputProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sparkleActive, setSparkleActive] = useState(false);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !sending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;

    setSending(true);
    const captured = trimmed;
    setText("");

    await sendChatMessage(groupId, captured);
    setSending(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 border-t bg-background px-3 py-2"
    >
      <button
        type="button"
        onClick={() => setSparkleActive((prev) => !prev)}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
          sparkleActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        aria-label="Sugestão de IA"
      >
        <Sparkles className="h-4 w-4" />
      </button>

      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enviar mensagem..."
        className={cn(
          "min-w-0 flex-1 rounded-full border bg-muted px-4 py-1.5 text-sm outline-none transition-colors focus:bg-background",
          sparkleActive ? "border-primary" : "border-transparent focus:border-input",
        )}
      />

      <button
        type="submit"
        disabled={!canSend}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
          canSend
            ? "bg-primary text-primary-foreground"
            : "cursor-not-allowed bg-muted text-muted-foreground",
        )}
        aria-label="Enviar"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}
