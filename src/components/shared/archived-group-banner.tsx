"use client";

import { Archive } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { haptics } from "@/hooks/use-haptics";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { unarchiveGroup } from "@/lib/sync/mutations-group";

const COPY = {
  group: { label: "Grupo arquivado", toast: "Grupo desarquivado" },
  conversation: { label: "Conversa arquivada", toast: "Conversa desarquivada" },
} as const;

export function ArchivedGroupBanner({
  groupId,
  kind,
}: {
  groupId: string;
  kind: keyof typeof COPY;
}) {
  const [unarchiving, setUnarchiving] = useState(false);
  const copy = COPY[kind];

  const handleUnarchive = async () => {
    setUnarchiving(true);
    haptics.tap();
    try {
      await unarchiveGroup(groupId);
      toast.success(copy.toast);
    } catch (error) {
      haptics.error();
      toast.error(ledgerErrorMessage(error));
    } finally {
      setUnarchiving(false);
    }
  };

  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl bg-muted px-3 py-2">
      <Archive className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-sm font-medium">{copy.label}</span>
      <Button
        variant="ghost"
        className="min-h-11 shrink-0"
        disabled={unarchiving}
        onClick={() => void handleUnarchive()}
      >
        Desarquivar
      </Button>
    </div>
  );
}
