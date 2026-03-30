"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { QrScannerView } from "@/components/bill/qr-scanner-view";
import { parseClaimQrCode } from "@/lib/claim-qr";
import { parseNfceQrCode } from "@/lib/nfce-qr";

export default function ScanInvitePage() {
  const router = useRouter();
  const [hint, setHint] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const handleDecode = useCallback(
    (data: string) => {
      const claim = parseClaimQrCode(data);
      if (claim) {
        setPaused(true);
        router.push(`/claim/${claim.token}`);
        return;
      }

      const nfce = parseNfceQrCode(data);
      if (nfce) {
        setHint("Use 'Escanear NFC' para cupons fiscais");
        return;
      }
    },
    [router],
  );

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
          <h1 className="font-semibold">Entrar em conta</h1>
          <p className="text-xs text-muted-foreground">
            Escaneie o QR code do convite
          </p>
        </div>
      </div>

      <div className="mt-6">
        <QrScannerView onDecode={handleDecode} paused={paused} />
        {hint ? (
          <p className="mt-3 text-center text-sm text-muted-foreground">{hint}</p>
        ) : (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Posicione o QR code do convite dentro do quadrado
          </p>
        )}
      </div>
    </div>
  );
}
