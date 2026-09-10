"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/ledger";

interface ChatMessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
}

export function ChatMessageBubble({ message, isOwn }: ChatMessageBubbleProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex">
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2",
          isOwn
            ? "ml-auto rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted",
        )}
      >
        <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
      </div>
    </motion.div>
  );
}
