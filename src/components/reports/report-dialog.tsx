"use client";

import { useId, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import type { ReportReason } from "@/lib/reports";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export type ReportDialogState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "success"; reportId: string };

export interface ReportDialogProps {
  open: boolean;
  subject: { id: string; name: string; handle: string; avatarUrl?: string | null };
  kind: "message" | "user";
  messagePreview: string | null;
  reason: ReportReason | "";
  details: string;
  frozen: boolean;
  state: ReportDialogState;
  errorKind: "retryable" | "terminal";
  onReasonChange: (reason: ReportReason) => void;
  onDetailsChange: (details: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

const reasons: readonly { value: ReportReason; label: string }[] = [
  { value: "assedio", label: "Assédio ou perseguição" },
  { value: "discurso_de_odio", label: "Discurso de ódio" },
  { value: "ameaca_ou_violencia", label: "Ameaça ou violência" },
  { value: "conteudo_sexual", label: "Conteúdo sexual impróprio" },
  { value: "golpe_ou_spam", label: "Golpe ou spam" },
  { value: "outro", label: "Outro motivo" },
];

export function ReportDialog({ open, subject, kind, messagePreview, reason, details, frozen, state, errorKind, onReasonChange, onDetailsChange, onSubmit, onClose }: ReportDialogProps): React.JSX.Element {
  const id = useId();
  const firstReason = useRef<HTMLInputElement>(null);
  const busy = state.status === "submitting";
  const success = state.status === "success";
  const retryableError = state.status === "error" && errorKind === "retryable";
  const count = Array.from(details).length;
  return (
    <Dialog open={open} dismissable={!busy} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} initialFocus={success || frozen ? true : firstReason} aria-busy={busy}>
        {!success && <DialogHeader>
          <DialogTitle>{kind === "message" ? "Denunciar mensagem" : "Denunciar pessoa"}</DialogTitle>
          <DialogDescription>Conte o que aconteceu. Sua denúncia será analisada pela equipe do Dividimos em até 7 dias.</DialogDescription>
        </DialogHeader>}
        {state.status === "success" ? <div role="status" className="space-y-3 rounded-xl bg-muted p-4">
          <CheckCircle2 aria-hidden="true" className="size-6 text-primary-text" />
          <DialogHeader><DialogTitle>Denúncia enviada</DialogTitle><DialogDescription>Vamos analisar sua denúncia em até 7 dias.</DialogDescription></DialogHeader>
          <p className="break-all text-sm tabular-nums text-muted-foreground">Protocolo: {state.reportId}</p>
        </div> : <>
          <div className="flex min-w-0 items-center gap-3 rounded-xl border p-3"><UserAvatar id={subject.id} name={subject.name} avatarUrl={subject.avatarUrl} /><div className="min-w-0"><p className="truncate text-sm font-semibold" title={subject.name}>{subject.name}</p><p className="truncate text-sm text-muted-foreground" title={`@${subject.handle}`}>@{subject.handle}</p></div></div>
          {kind === "message" && messagePreview !== null && <div className="space-y-1 rounded-xl bg-muted p-3"><p className="text-xs font-semibold text-muted-foreground">Mensagem selecionada</p><p className="line-clamp-3 break-words whitespace-pre-wrap text-sm">{messagePreview}</p></div>}
          <fieldset disabled={busy || frozen} className="min-w-0">
            <legend className="mb-2 text-sm font-semibold">Motivo</legend>
            <div className="divide-y rounded-xl border">{reasons.map((option, index) => <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm has-checked:bg-primary/10 has-disabled:cursor-default"><input ref={index === 0 ? firstReason : undefined} type="radio" name={`${id}-reason`} value={option.value} checked={reason === option.value} onChange={() => onReasonChange(option.value)} className="size-4 shrink-0 accent-primary" />{option.label}</label>)}</div>
          </fieldset>
          <div className="space-y-2">
            <label htmlFor={`${id}-details`} className="text-sm font-semibold">Detalhes (opcional)</label>
            <textarea id={`${id}-details`} value={details} disabled={busy || frozen} onChange={(event) => onDetailsChange(event.target.value)} placeholder="Se quiser, explique o que aconteceu." rows={3} aria-describedby={`${id}-limit`} aria-invalid={count > 1000} className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-base leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:text-muted-foreground md:text-sm" />
            <p id={`${id}-limit`} className={count > 1000 ? "flex justify-between gap-2 text-xs text-destructive-text" : "flex justify-between gap-2 text-xs text-muted-foreground"}><span>Até 1.000 caracteres.</span><span className="tabular-nums">{count.toLocaleString("pt-BR")}/1.000</span></p>
          </div>
          <p className="text-sm text-muted-foreground">A pessoa denunciada não recebe este aviso.</p>
          {state.status === "error" && <div className="space-y-2"><p role="alert" className="text-sm text-destructive-text">{state.message}</p>{retryableError && frozen && <p className="text-sm text-muted-foreground">Ao tentar de novo, vamos reenviar a mesma denúncia.</p>}</div>}
          {busy && <p role="status" className="sr-only">Enviando…</p>}
        </>}
        <DialogFooter>
          {success ? <Button size="lg" onClick={onClose}>Fechar</Button> : <>
            <Button variant="outline" size="lg" disabled={busy} onClick={onClose}>Cancelar</Button>
            <Button size="lg" disabled={busy || reason === "" || count > 1000} onClick={onSubmit}>{busy ? "Enviando…" : retryableError ? "Tentar enviar de novo" : "Enviar denúncia"}</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
