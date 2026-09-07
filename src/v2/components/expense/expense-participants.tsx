"use client";

import { QrCode, Share2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { GuestClaimShareModal } from "@/components/bill/guest-claim-share-modal";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { issueGuestClaimToken } from "@/lib/sync/mutations-group";
import type { Participant } from "@/types/ledger";

interface ExpenseParticipantsProps {
  participants: Participant[];
  participantName: (participantIndex: number) => string;
  expenseTitle: string;
}

interface GuestShare {
  guestId: string;
  guestName: string;
  token: string;
  shareAmountCents: number;
}

function amountsLabel(participant: Participant): string {
  const parts: string[] = [];
  if (participant.paidCents > 0) {
    parts.push(`pagou ${formatBRL(participant.paidCents)}`);
  }
  parts.push(`parte ${formatBRL(participant.shareCents)}`);
  return parts.join(" · ");
}

export function ExpenseParticipants({
  participants,
  participantName,
  expenseTitle,
}: ExpenseParticipantsProps) {
  const [share, setShare] = useState<GuestShare | null>(null);
  const [generation, setGeneration] = useState(0);
  const [issuing, setIssuing] = useState(false);

  async function issueClaimLink(
    guestId: string,
    guestName: string,
    shareAmountCents: number,
  ) {
    setIssuing(true);
    try {
      const token = await issueGuestClaimToken(guestId);
      setShare({ guestId, guestName, token, shareAmountCents });
      setGeneration((current) => current + 1);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      setIssuing(false);
    }
  }

  return (
    <section className="mt-5">
      <h2 className="mb-2 text-sm font-semibold">Quem participou</h2>
      <div className="space-y-2">
        {participants.map((participant) => {
          const name = participantName(participant.participantIndex);

          if (participant.kind === "guest") {
            const guestId = participant.guest?.id ?? null;
            return (
              <div
                key={`guest-${participant.participantIndex}`}
                className="rounded-xl border border-dashed bg-card p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                    {name.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Convidado
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {amountsLabel(participant)}
                    </p>
                  </div>
                </div>
                {guestId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full gap-1.5 text-xs"
                    disabled={issuing}
                    onClick={() =>
                      issueClaimLink(guestId, name, participant.shareCents)
                    }
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    Compartilhar convite
                  </Button>
                )}
              </div>
            );
          }

          return (
            <div
              key={`user-${participant.participantIndex}`}
              className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
            >
              <UserAvatar
                name={name}
                avatarUrl={participant.user?.avatarUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">
                  {amountsLabel(participant)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <GuestClaimShareModal
        key={generation}
        open={share !== null}
        onClose={() => setShare(null)}
        guestName={share?.guestName ?? ""}
        token={share?.token ?? null}
        shareAmountCents={share?.shareAmountCents}
        expenseTitle={expenseTitle}
        footer={
          share !== null ? (
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={issuing}
              onClick={() =>
                issueClaimLink(
                  share.guestId,
                  share.guestName,
                  share.shareAmountCents,
                )
              }
            >
              <Share2 className="h-4 w-4" />
              Gerar novo link
            </Button>
          ) : null
        }
      />
    </section>
  );
}
