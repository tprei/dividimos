"use client";

import { ArrowLeft, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { UserProfile } from "@/types";

interface ConversationHeaderProps {
  counterparty: UserProfile;
  onNewExpense?: () => void;
}

export function ConversationHeader({
  counterparty,
  onNewExpense,
}: ConversationHeaderProps) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-3 border-b border-border/50 bg-background px-3 py-2.5">
      <button
        onClick={() => router.back()}
        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Voltar"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <UserAvatar
        name={counterparty.name}
        avatarUrl={counterparty.avatarUrl}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{counterparty.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          @{counterparty.handle}
        </p>
      </div>
      {onNewExpense && (
        <button
          onClick={onNewExpense}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          aria-label="Nova conta"
        >
          <Plus className="h-4 w-4" />
          <span>Nova conta</span>
        </button>
      )}
    </div>
  );
}
