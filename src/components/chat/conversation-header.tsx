"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { UserProfile } from "@/types";

interface ConversationHeaderProps {
  counterparty: UserProfile;
  actions?: ReactNode;
}

export function ConversationHeader({
  counterparty,
  actions,
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
      {actions}
    </div>
  );
}
