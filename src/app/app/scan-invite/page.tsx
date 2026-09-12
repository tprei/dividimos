"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { QrScannerView } from "@/components/bill/qr-scanner-view";
import { useStartBillWithUser } from "@/components/profile/use-start-bill-with-user";
import { parseNfceQrCode } from "@/lib/nfce-qr";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { parseClaimQrCode } from "@/lib/claim-qr";
import { parseGroupInviteQrCode, parseProfileQrCode } from "@/lib/invite-qr";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { joinViaLink, lookupUserByHandle } from "@/lib/sync/mutations-group";
import type { UserProfile } from "@/types";

export default function ScanInvitePage() {
  const router = useRouter();
  const { startBill, openConversation, starting } = useStartBillWithUser();
  const [hint, setHint] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [scannedProfile, setScannedProfile] = useState<UserProfile | null>(null);

  const handleDecode = useCallback(
    (data: string) => {
      const claim = parseClaimQrCode(data);
      if (claim) {
        setPaused(true);
        router.push(`/claim#${claim.token}`);
        return;
      }

      const invite = parseGroupInviteQrCode(data);
      if (invite) {
        setPaused(true);
        void (async () => {
          try {
            const ack = await joinViaLink(invite.token);
            router.push(`/app/groups/${ack.groupId}`);
          } catch (error) {
            toast.error(ledgerErrorMessage(error));
            setHint("Esse convite não é mais válido.");
            setPaused(false);
          }
        })();
        return;
      }

      const profile = parseProfileQrCode(data);
      if (profile) {
        setPaused(true);
        void (async () => {
          const user = await lookupUserByHandle(profile.handle);
          if (!user) {
            toast.error("Não achamos esse perfil.");
            setPaused(false);
            return;
          }
          setScannedProfile(user);
        })();
        return;
      }

      const nfce = parseNfceQrCode(data);
      if (nfce) {
        setHint("Use 'Escanear NFC' para cupons fiscais");
      }
    },
    [router],
  );

  const dismissProfile = useCallback(() => {
    setScannedProfile(null);
    setPaused(false);
  }, []);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="font-semibold">Escanear</h1>
          <p className="text-xs text-muted-foreground">
            Convite de grupo, perfil ou conta
          </p>
        </div>
      </div>

      <div className="mt-6">
        {scannedProfile ? (
          <div className="grid gap-4 rounded-2xl border bg-card p-5 text-center">
            <div className="flex flex-col items-center gap-2">
              <UserAvatar name={scannedProfile.name} avatarUrl={scannedProfile.avatarUrl ?? null} size="lg" />
              <p className="text-base font-semibold">{scannedProfile.name}</p>
              <p className="text-sm text-muted-foreground">@{scannedProfile.handle}</p>
            </div>
            <Button
              className="h-11 w-full"
              disabled={starting}
              onClick={() => void startBill(scannedProfile.id)}
            >
              Dividir uma conta
            </Button>
            <Button
              variant="outline"
              className="h-11 w-full"
              disabled={starting}
              onClick={() => void openConversation(scannedProfile.id)}
            >
              Mandar mensagem
            </Button>
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={dismissProfile}>
              Cancelar
            </Button>
          </div>
        ) : (
          <>
            <QrScannerView onDecode={handleDecode} paused={paused} />
            {hint ? (
              <p className="mt-3 text-center text-sm text-muted-foreground">{hint}</p>
            ) : (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Posicione o QR code do convite dentro do quadrado
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
