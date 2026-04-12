"use client";

import { UserAvatar } from "@/components/shared/user-avatar";
import type { ChatMessageWithSender } from "@/types";

interface ChatMessageBubbleProps {
  message: ChatMessageWithSender;
  isOwn: boolean;
}

export function ChatMessageBubble({ message, isOwn }: ChatMessageBubbleProps) {
  const time = new Date(message.createdAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={`flex items-end gap-2 ${isOwn ? "flex-row-reverse" : "flex-row"}`}
    >
      {!isOwn && (
        <UserAvatar
          name={message.sender.name}
          avatarUrl={message.sender.avatarUrl}
          size="xs"
        />
      )}
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 ${
          isOwn
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted"
        }`}
      >
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content}
        </p>
        <p
          className={`mt-0.5 text-[10px] ${
            isOwn
              ? "text-primary-foreground/60"
              : "text-muted-foreground"
          }`}
        >
          {time}
        </p>
      </div>
    </div>
  );
}
