"use client";

import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type NativeUpdateScreenProps =
  | { state: "check-error"; onReload: () => void }
  | {
      state: "update-required";
      canOpenStore: boolean;
      storeState: "idle" | "opening" | "error" | "opened";
      onOpenStore: () => void;
    };

export function NativeUpdateScreen(props: NativeUpdateScreenProps): React.JSX.Element {
  const checkError = props.state === "check-error";
  const busy = props.state === "update-required" && props.storeState === "opening";
  return (
    <main className="flex min-h-full flex-1 items-center justify-center overflow-y-auto px-4 py-6" aria-busy={busy}>
      <div className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-6">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary-text">{checkError ? <RefreshCw aria-hidden="true" className="size-7" /> : <Download aria-hidden="true" className="size-7" />}</div>
        <div className="space-y-3">
          <h1 className="text-2xl font-bold leading-tight">{checkError ? "Não foi possível verificar a versão" : "Atualize o Dividimos"}</h1>
          <p role={checkError ? "alert" : undefined} className="text-base leading-relaxed text-muted-foreground">{checkError ? "Feche e abra o Dividimos ou tente novamente." : "Esta versão do app não é mais compatível. Atualize para continuar."}</p>
        </div>
        {props.state === "check-error" ? <Button size="lg" className="w-full" onClick={props.onReload}>Tentar novamente</Button> : props.canOpenStore ? <div className="space-y-3">
          {props.storeState === "error" && <p role="alert" className="text-sm leading-relaxed text-destructive-text">Não foi possível abrir a Play Store. Tente novamente.</p>}
          <Button size="lg" className="w-full" disabled={busy} onClick={props.onOpenStore}>{busy ? "Abrindo a Play Store…" : "Atualizar na Play Store"}</Button>
          <p role={props.storeState === "opened" ? "status" : undefined} className="text-sm leading-relaxed text-muted-foreground">Depois de instalar a atualização, abra o Dividimos de novo.</p>
          {busy && <p role="status" className="sr-only">Abrindo a Play Store…</p>}
        </div> : <p className="break-words text-sm leading-relaxed text-muted-foreground">Precisa de ajuda? Fale com <span className="select-text font-medium text-foreground">contato@dividimos.ai</span>.</p>}
      </div>
    </main>
  );
}
