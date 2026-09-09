"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { CONVERSATIONS, ME, type ConversationFixture } from "../fixtures";
import type { ScreenProps } from "../mobile-preview";
import { PreviewShell } from "../preview-shell";
import { Money } from "../ui/money";
import { ScreenHeader } from "../ui/screen-header";

const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "owes", label: "A pagar" },
  { key: "owed", label: "A receber" },
  { key: "none", label: "Sem saldo" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function isFilterKey(value: string | null): value is FilterKey {
  return FILTERS.some((filter) => filter.key === value);
}

function matchesFilter(filter: FilterKey, netCents: number): boolean {
  if (filter === "owes") return netCents < 0;
  if (filter === "owed") return netCents > 0;
  if (filter === "none") return netCents === 0;
  return true;
}

function matchesQuery(query: string, conversation: ConversationFixture): boolean {
  if (!query) return true;
  return conversation.name.toLowerCase().includes(query);
}

export function ConversationsScreen({ section }: ScreenProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>(isFilterKey(section) ? section : "all");

  const normalizedQuery = query.trim().toLowerCase();
  const visible = CONVERSATIONS.filter(
    (conversation) =>
      matchesQuery(normalizedQuery, conversation) && matchesFilter(filter, conversation.netCents),
  );

  return (
    <PreviewShell nav="conversations">
      <ScreenHeader title="Conversas" />
      <div className="px-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome"
            aria-label="Buscar por nome"
            className="h-9 rounded-full border-border bg-card pl-9 text-[13px]"
          />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1 border-b border-border">
          {FILTERS.map((option) => {
            const active = filter === option.key;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(option.key)}
                className={cn(
                  "-mb-px flex h-9 items-center justify-center border-b-2 text-[12.5px] font-semibold transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3.5 px-4 pb-4">
        {visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma conversa encontrada
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`/demo/mobile/chat?section=${conversation.id}`}
                  className="flex items-center gap-3 rounded-[20px] border bg-card p-3"
                >
                  <UserAvatar name={conversation.avatarName} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold">
                        {conversation.name}
                      </span>
                      <span className="flex-none text-[11px] text-muted-foreground">
                        {conversation.time}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      {conversation.kind === "group" && (
                        <UserAvatar
                          name={conversation.speaker.name}
                          size="xs"
                          className="h-[18px] w-[18px] flex-none text-[8px]"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                        {conversation.kind === "dm" && conversation.speaker.id === ME.id && "Você: "}
                        {conversation.preview}
                      </span>
                      {conversation.netCents !== 0 && (
                        <Money cents={conversation.netCents} signed className="flex-none text-[11.5px]" />
                      )}
                      {conversation.unread > 0 && (
                        <span
                          aria-label={`${conversation.unread} mensagens não lidas`}
                          className="flex h-[17px] min-w-[17px] flex-none items-center justify-center rounded-full bg-primary px-[5px] text-[9.5px] font-extrabold text-primary-foreground"
                        >
                          {conversation.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PreviewShell>
  );
}
