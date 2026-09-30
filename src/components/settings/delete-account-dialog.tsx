"use client";

import { useRef } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { AccountDeletionGroup } from "@/lib/account-deletion";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export type DeleteAccountDialogState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "blocked"; groups: readonly AccountDeletionGroup[] }
  | { status: "error"; message: string; committed: boolean }
  | { status: "success" };

export interface DeleteAccountDialogProps {
  open: boolean;
  state: DeleteAccountDialogState;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}

const consequences = [
  "Seu nome, e-mail, foto, chave Pix e preferências serão apagados ou anonimizados.",
  "Você vai sair de todos os grupos e seus links de convite serão desativados.",
  "Suas mensagens vão aparecer como “Mensagem apagada”, de “Conta excluída”.",
  "Despesas, pagamentos e o histórico financeiro compartilhado ficam para não alterar os saldos das outras pessoas.",
  "Se entrar de novo com o mesmo Google, você cria uma nova conta.",
];

export function DeleteAccountDialog({ open, state, confirmed, onConfirmedChange, onClose, onConfirm }: DeleteAccountDialogProps): React.JSX.Element {
  const title = useRef<HTMLHeadingElement>(null);
  const busy = state.status === "loading";
  const committed = state.status === "success" || (state.status === "error" && state.committed);
  return (
    <Dialog open={open} dismissable={!busy && !committed} onOpenChange={(next) => { if (!next && !busy && !committed) onClose(); }}>
      <DialogContent showCloseButton={false} initialFocus={title} aria-busy={busy}>
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1}>Excluir sua conta do Dividimos?</DialogTitle>
          <DialogDescription>Essa ação não pode ser desfeita.</DialogDescription>
        </DialogHeader>
        {!committed && <>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed marker:text-muted-foreground">{consequences.map((text) => <li key={text}>{text}</li>)}</ul>
          <Separator />
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-muted p-3 text-sm font-medium leading-relaxed">
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={confirmed} disabled={busy} onChange={(event) => onConfirmedChange(event.target.checked)} />
            Entendi e quero excluir minha conta do Dividimos.
          </label>
        </>}
        {state.status === "blocked" && <div className="space-y-2">
          <p role="alert" className="text-sm font-medium">Antes de excluir sua conta do Dividimos, acerte os saldos destes grupos.</p>
          <ul className="divide-y rounded-xl border">{state.groups.map((group) => <li key={group.id}><Link href={`/app/groups/${group.id}`} aria-label={`Abrir grupo ${group.name}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-primary-text outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 break-words">{group.name}</span><ChevronRight aria-hidden="true" className="size-4 shrink-0" /></Link></li>)}</ul>
        </div>}
        {state.status === "error" && <p role="alert" className="text-sm leading-relaxed text-destructive-text">{state.committed ? "Seus dados já foram apagados ou anonimizados. Falta encerrar o acesso. Tente novamente." : state.message}</p>}
        {busy && <p role="status" className="text-sm text-muted-foreground">Excluindo sua conta…</p>}
        {state.status === "success" && <p role="status" className="rounded-xl bg-muted p-4 text-sm">Sua conta do Dividimos foi excluída.</p>}
        {state.status !== "success" && <DialogFooter className="sm:flex-col-reverse">
          {!committed && <Button size="lg" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>}
          <Button size="lg" variant="destructive" className="h-auto min-h-11 whitespace-normal py-2" disabled={busy || (!committed && !confirmed)} onClick={onConfirm}>{busy ? "Excluindo sua conta…" : state.status === "blocked" ? "Já acertei os saldos, tentar de novo" : state.status === "error" ? "Tentar novamente" : "Excluir minha conta do Dividimos"}</Button>
        </DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
