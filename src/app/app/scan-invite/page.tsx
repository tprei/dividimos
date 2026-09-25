"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";
import { QrScannerView } from "@/components/bill/qr-scanner-view";
import { useQrScannerPreload } from "@/hooks/use-qr-preload";
import { useStartBillWithUser } from "@/components/profile/use-start-bill-with-user";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseClaimQrCode } from "@/lib/claim-qr";
import { parseAssignmentRoomQrCode } from "@/lib/assignment-room-qr";
import { INVITE_TOKEN_RE, parseGroupInviteQrCode, parseProfileQrCode } from "@/lib/invite-qr";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { joinViaLink, lookupUserByHandle } from "@/lib/sync/mutations-group";
import type { UserProfile } from "@/types/ledger";

export default function ScanInvitePage() {
  const router = useRouter();
  const { startBill, openConversation, starting } = useStartBillWithUser();
  useQrScannerPreload();
  const [hint, setHint] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [scannedProfile, setScannedProfile] = useState<UserProfile | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [typing, setTyping] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const handleDecode = useCallback(
    (data: string) => {
      const room = parseAssignmentRoomQrCode(data);
      if (room) {
        setPaused(true);
        router.push(room.url);
        return;
      }

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
          // The sheet unmounts the focused input, so no blur fires to reset typing.
          setTyping(false);
          setScannedProfile(user);
        })();
      }
      if (!profile) setHint("Esse código não é um convite do Dividimos.");
    },
    [router],
  );

  const dismissProfile = useCallback(() => {
    setScannedProfile(null);
    setPaused(false);
    setTyping(false);
  }, []);

  const showCamera = useCallback(() => {
    codeInputRef.current?.blur();
    setTyping(false);
  }, []);

  return (
    <div className="mx-auto max-w-lg px-4 py-6 keyboard:py-3">
      <div className="flex items-center gap-3">
        <Link
          href="/app"
          aria-label="Fechar scanner"
          className="flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold keyboard:text-xl">Escanear</h1>
          <p className="text-xs text-muted-foreground keyboard:hidden">
            Convite de grupo, perfil ou conta
          </p>
        </div>
      </div>

      <div className="mt-6 keyboard:mt-3">
        {scannedProfile ? (
          <div className="grid gap-4 rounded-2xl border bg-card p-5 text-center">
            <div className="flex flex-col items-center gap-2">
              <UserAvatar id={scannedProfile.id} name={scannedProfile.name} avatarUrl={scannedProfile.avatarUrl ?? null} size="lg" isBot={scannedProfile.isBot} />
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
            <QrScannerView onDecode={handleDecode} paused={paused} collapsed={typing} onExpand={showCamera} />
            {hint && <p role="status" className="mt-3 text-center text-sm text-muted-foreground">{hint}</p>}
            <form
              className="mt-6 space-y-3 rounded-2xl border border-border bg-card p-4 keyboard:mt-3"
              onFocus={() => setTyping(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setTyping(false);
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const code = manualCode.trim();
                handleDecode(INVITE_TOKEN_RE.test(code) ? `/join/${code}` : code);
              }}
            >
              <label htmlFor="invite-code" className="block text-sm font-semibold">Link ou código</label>
              <Input ref={codeInputRef} id="invite-code" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Convite do Dividimos" autoCapitalize="none" autoCorrect="off" enterKeyHint="go" />
              {/* Keeping focus in the field on press stops the camera from re-expanding under the finger before the click lands. */}
              <Button type="submit" variant={manualCode.trim() ? "default" : "outline"} className="w-full" disabled={!manualCode.trim() || paused} onMouseDown={(event) => event.preventDefault()}>Abrir convite</Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
