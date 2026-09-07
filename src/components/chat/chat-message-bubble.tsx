"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { ChatMessage } from "@/types/ledger";

interface ChatMessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  showAvatar: boolean;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatMessageBubble({ message, isOwn, showAvatar }: ChatMessageBubbleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex items-end gap-2", isOwn ? "flex-row-reverse" : "flex-row")}
    >
      <div className="w-6 shrink-0">
        {showAvatar && !isOwn && (
          <UserAvatar
            name={message.sender.name}
            avatarUrl={message.sender.avatarUrl}
            size="xs"
          />
        )}
      </div>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2",
          isOwn
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted",
        )}
      >
        <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
        <p
          className={cn(
            "mt-0.5 text-right text-[10px]",
            isOwn ? "text-primary-foreground/60" : "text-muted-foreground",
          )}
        >
          {formatTime(message.createdAt)}
        </p>
      </div>
    </motion.div>
  );
}
