"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/shared/user-avatar";
import { SystemMessageCard, type SystemMessageData } from "@/components/chat/system-message-card";
import type { ChatMessageWithSender, Expense, Settlement, UserProfile } from "@/types";

interface ChatMessageBubbleProps {
  message: ChatMessageWithSender;
  isOwn: boolean;
  expenses: Map<string, Expense>;
  settlements: Map<string, { settlement: Settlement; fromUser: UserProfile; toUser: UserProfile }>;
  showAvatar: boolean;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatMessageBubble({
  message,
  isOwn,
  expenses,
  settlements,
  showAvatar,
}: ChatMessageBubbleProps) {
  // System messages are centered
  if (message.messageType === "system_expense" && message.expenseId) {
    const expense = expenses.get(message.expenseId);
    if (expense) {
      const data: SystemMessageData = {
        type: "system_expense",
        expense: { expense, creator: message.sender },
      };
      return (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="py-1"
        >
          <SystemMessageCard messageType={message.messageType} data={data} />
        </motion.div>
      );
    }
  }

  if (message.messageType === "system_settlement" && message.settlementId) {
    const settlementData = settlements.get(message.settlementId);
    if (settlementData) {
      const data: SystemMessageData = {
        type: "system_settlement",
        settlement: settlementData,
      };
      return (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="py-1"
        >
          <SystemMessageCard messageType={message.messageType} data={data} />
        </motion.div>
      );
    }
  }

  // Text messages
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
