"use client";

import { motion } from "framer-motion";
import { formatChatTime } from "@/components/chat/chat-rail-row";
import { cn } from "@/lib/utils";
import { popIn } from "@/lib/animations";
import type { ChatMessage } from "@/types/ledger";

interface ChatMessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  senderLabel?: string;
}

export function ChatMessageBubble({ message, isOwn, senderLabel }: ChatMessageBubbleProps) {
  return (
    <motion.div variants={popIn} initial="hidden" animate="visible" className="flex min-w-0">
      <div
        className={cn(
          "relative max-w-[85%] rounded-[0.75rem] border px-2.5 pt-1.5 pb-1",
          isOwn
            ? "ml-auto rounded-br-[0.25rem] border-primary/25 bg-primary/15"
            : "rounded-tl-[0.25rem] border-border bg-card",
        )}
      >
        {senderLabel && (
          <p className="truncate text-xs font-semibold text-muted-foreground">{senderLabel}</p>
        )}
        <p className="whitespace-pre-wrap break-words text-base leading-snug md:text-sm">
          {message.content}
          <span aria-hidden="true" className="inline-block w-11" />
        </p>
        <time
          dateTime={message.createdAt}
          className="absolute right-2 bottom-1 text-2xs leading-4 tabular-nums text-muted-foreground"
        >
          {formatChatTime(message.createdAt)}
        </time>
      </div>
    </motion.div>
  );
}
