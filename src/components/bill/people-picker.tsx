"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Plus, Search } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { ContactRowSkeleton } from "@/components/shared/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { useHandleLookup } from "@/hooks/use-handle-lookup";
import { haptics } from "@/hooks/use-haptics";
import { fade, popIn } from "@/lib/animations";
import { matchPeople, parseHandleQuery } from "@/lib/person-search";
import { useAppStore } from "@/stores/app-store";
import { rankKnownPeople } from "@/stores/app-selectors";
import type { Me, UserProfile } from "@/types/ledger";

export interface PeoplePickerProps {
  me: Me;
  selectedIds: readonly string[];
  showSuggestions: boolean;
  onAddPerson: (profile: UserProfile) => void;
  onAddGuest: (name: string) => void;
}

function PersonRow({
  profile,
  selected,
  onAdd,
}: {
  profile: UserProfile;
  selected: boolean;
  onAdd: (profile: UserProfile) => void;
}) {
  const content = (
    <>
      <UserAvatar id={profile.id} name={profile.name} avatarUrl={profile.avatarUrl} size="sm" isBot={profile.isBot} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-5" title={profile.name}>{profile.name}</span>
        <span className="block truncate text-xs font-normal leading-4 text-muted-foreground" title={`@${profile.handle}`}>@{profile.handle}</span>
      </span>
      {selected ? <Chip>Na conta</Chip> : <Plus className="size-4 text-primary-text" aria-hidden="true" />}
    </>
  );

  return selected ? (
    <div className="flex h-12 items-center gap-2.5 px-3 py-1.5">{content}</div>
  ) : (
    <Button
      type="button"
      variant="ghost"
      aria-label={`Adicionar ${profile.name}`}
      onClick={() => onAdd(profile)}
      className="h-12 w-full justify-start gap-2.5 rounded-none border-0 px-3 py-1.5 text-left focus-visible:ring-inset motion-safe:active:scale-100"
    >
      {content}
    </Button>
  );
}

export function PeoplePicker({
  me,
  selectedIds,
  showSuggestions,
  onAddPerson,
  onAddGuest,
}: PeoplePickerProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const reduceMotion = useReducedMotion();
  const groups = useAppStore((s) => s.groups);
  const groupOrder = useAppStore((s) => s.groupOrder);
  const blockedUsers = useAppStore((s) => s.blockedUsers);
  const knownPeople = useMemo(
    () => rankKnownPeople(groups, groupOrder, me.id, blockedUsers),
    [groups, groupOrder, me.id, blockedUsers],
  );
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const blockedIds = useMemo(() => new Set(blockedUsers.map((profile) => profile.id)), [blockedUsers]);
  const localMatches = useMemo(() => matchPeople(knownPeople, query), [knownPeople, query]);
  const suggestions = useMemo(
    () => knownPeople.filter((profile) => !selected.has(profile.id)),
    [knownPeople, selected],
  );
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.replace(/^@/, "").toLowerCase();
  const handleQuery = parseHandleQuery(query);
  const isMyHandle = normalizedQuery !== "" && normalizedQuery === me.handle.toLowerCase();
  const isKnownHandle = normalizedQuery !== "" && knownPeople.some((profile) => profile.handle.toLowerCase() === normalizedQuery);
  const remoteHandle = handleQuery.kind === "explicit" && !isKnownHandle && !isMyHandle
    ? handleQuery.handle
    : null;
  const { lookup, retry } = useHandleLookup(remoteHandle);
  const foundProfile = lookup.status === "found" ? lookup.profile : null;
  const isFoundHandle = foundProfile !== null && foundProfile.handle.toLowerCase() === normalizedQuery;
  const showGuest = trimmedQuery !== "" && !trimmedQuery.startsWith("@") && !isKnownHandle && !isFoundHandle;
  const showHandleAction = handleQuery.kind === "implicit" && !isKnownHandle && !isMyHandle;
  const idleSuggestions = trimmedQuery === "" && showSuggestions;
  let visiblePeople: UserProfile[] = [];
  if (trimmedQuery !== "") {
    visiblePeople = localMatches;
  } else if (idleSuggestions && showAllSuggestions) {
    visiblePeople = suggestions;
  } else if (idleSuggestions) {
    visiblePeople = suggestions.slice(0, 6);
  }
  const hasResults = visiblePeople.length > 0 || isMyHandle || lookup.status !== "idle" || showGuest || showHandleAction;

  const focusInput = () => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      input.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    });
  };

  const addPerson = (profile: UserProfile) => {
    if (profile.id === me.id || selected.has(profile.id) || blockedIds.has(profile.id)) return;
    haptics.selectionChanged();
    onAddPerson(profile);
    setQuery("");
    focusInput();
  };

  const addGuest = () => {
    if (!showGuest) return;
    haptics.tap();
    onAddGuest(trimmedQuery);
    setQuery("");
    focusInput();
  };

  return (
    <motion.div
      variants={reduceMotion ? fade : popIn}
      initial="hidden"
      animate="visible"
      className="min-w-0 space-y-1.5"
    >
      <div className="sticky top-0 z-10 bg-background pb-1 pt-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            type="text"
            aria-label="Adicionar pessoas"
            aria-controls={resultsId}
            placeholder="Nome ou @handle"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setShowAllSuggestions(false);
            }}
            onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (handleQuery.kind === "explicit") {
                const knownExact = knownPeople.find((profile) => profile.handle.toLowerCase() === handleQuery.handle);
                if (knownExact) addPerson(knownExact);
                else if (foundProfile !== null && foundProfile.handle.toLowerCase() === handleQuery.handle) addPerson(foundProfile);
                else if (lookup.status === "not_found" && showGuest) addGuest();
                return;
              }
              const firstLocal = localMatches.find((profile) => profile.id !== me.id && !selected.has(profile.id));
              if (firstLocal) addPerson(firstLocal);
              else if (foundProfile !== null && foundProfile.id !== me.id && !selected.has(foundProfile.id)) addPerson(foundProfile);
              else if (showGuest) addGuest();
            }}
            className="scroll-my-3 pl-9 text-base md:text-sm"
          />
        </div>
      </div>

      {idleSuggestions && suggestions.length > 0 && (
        <p className="px-1 text-xs font-semibold text-muted-foreground">Pessoas recentes</p>
      )}

      <div id={resultsId} className="max-h-[min(24rem,calc(var(--app-viewport-height)-7rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)))] overflow-y-auto overscroll-contain rounded-[0.75rem]">
        {hasResults && (
          <div className="divide-y divide-border overflow-hidden rounded-[0.75rem] border border-border bg-card">
            {visiblePeople.map((profile) => (
              <PersonRow key={profile.id} profile={profile} selected={selected.has(profile.id)} onAdd={addPerson} />
            ))}

            {isMyHandle && <p role="status" className="flex min-h-12 items-center px-3 text-sm text-muted-foreground">Esse é você</p>}

            {lookup.status === "loading" && (
              <div role="status" aria-label={`Buscando @${lookup.handle}`} className="px-1">
                <ContactRowSkeleton />
              </div>
            )}

            {lookup.status === "found" && lookup.profile.id === me.id && (
              <p role="status" className="flex min-h-12 items-center px-3 text-sm text-muted-foreground">Esse é você</p>
            )}

            {lookup.status === "found" && lookup.profile.id !== me.id && blockedIds.has(lookup.profile.id) && (
              <p role="status" className="min-h-12 break-words px-3 py-3 text-sm text-muted-foreground">Essa pessoa não está disponível para esta conta.</p>
            )}

            {lookup.status === "found" && lookup.profile.id !== me.id && !blockedIds.has(lookup.profile.id) && (
              <PersonRow profile={lookup.profile} selected={selected.has(lookup.profile.id)} onAdd={addPerson} />
            )}

            {lookup.status === "not_found" && (
              <p role="status" className="min-h-12 break-words px-3 py-3 text-sm text-muted-foreground">Ninguém com @{lookup.handle}</p>
            )}

            {lookup.status === "failed" && (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1.5">
                <p role="status" className="min-w-0 flex-1 break-words text-sm text-destructive-text">Não foi possível buscar @{lookup.handle}.</p>
                <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={retry}>Tentar novamente</Button>
              </div>
            )}

            {showHandleAction && handleQuery.kind === "implicit" && (
              <Button
                type="button"
                variant="ghost"
                aria-label={`Buscar @${handleQuery.handle}`}
                onClick={() => {
                  setQuery(`@${handleQuery.handle}`);
                  focusInput();
                }}
                className="min-h-12 w-full justify-start gap-2.5 rounded-none border-0 px-3 text-left focus-visible:ring-inset motion-safe:active:scale-100"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"><Search className="size-4 text-muted-foreground" aria-hidden="true" /></span>
                <span className="min-w-0 truncate">Buscar @{handleQuery.handle}</span>
              </Button>
            )}

            {showGuest && (
              <Button
                type="button"
                variant="ghost"
                aria-label={`Adicionar ${trimmedQuery} como convidado`}
                onClick={addGuest}
                className="h-12 w-full justify-start gap-2.5 rounded-none border-0 px-3 py-1.5 text-left focus-visible:ring-inset motion-safe:active:scale-100"
              >
                <GuestAvatar id={`guest:${trimmedQuery}`} name={trimmedQuery} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium leading-5" title={trimmedQuery}>{`Adicionar "${trimmedQuery}"`}</span>
                  <span className="block text-xs font-normal leading-4 text-muted-foreground">como convidado</span>
                </span>
                <Plus className="size-4 text-primary-text" aria-hidden="true" />
              </Button>
            )}

            {idleSuggestions && !showAllSuggestions && suggestions.length > 6 && (
              <Button
                type="button"
                variant="ghost"
                aria-expanded={showAllSuggestions}
                aria-controls={resultsId}
                onClick={() => setShowAllSuggestions(true)}
                className="min-h-11 w-full gap-1.5 rounded-none border-0 text-primary-text focus-visible:ring-inset motion-safe:active:scale-100"
              >
                Ver mais pessoas
                <ChevronDown className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
      </div>

      {idleSuggestions && knownPeople.length === 0 && (
        <p className="px-1 text-sm text-muted-foreground">Digite um nome ou @handle para adicionar alguém.</p>
      )}
    </motion.div>
  );
}
