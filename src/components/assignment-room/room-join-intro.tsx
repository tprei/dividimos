import { Check, MousePointer2, ReceiptText, ScanLine, Utensils } from "lucide-react";

const steps = [
  { icon: Utensils, title: "Escolha o que consumiu", detail: "Só seu ou dividido com a galera." },
  { icon: ReceiptText, title: "A conta se divide", detail: "Cada escolha entra no cálculo da sua parte." },
  { icon: ScanLine, title: "Acerte pelo Pix", detail: "Depois, é só pagar sua parte ao anfitrião." },
];

function SharedReceipt() {
  return (
    <div aria-hidden="true" className="relative mx-auto flex h-44 w-64 items-center justify-center compact:hidden md:h-56 md:w-72">
      <div className="absolute inset-x-4 inset-y-2 rounded-full bg-primary/15" />
      <svg viewBox="0 0 280 200" fill="none" className="absolute inset-0 size-full text-primary-text">
        <ellipse cx="140" cy="100" rx="125" ry="65" stroke="currentColor" strokeDasharray="3 7" opacity="0.4" />
        <path d="M38 40v12m-6-6h12M235 150v12m-6-6h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="relative w-36 -rotate-6 rounded-xl border border-border bg-card p-4 shadow-lg motion-reduce:rotate-0">
        <ReceiptText className="mx-auto mb-3 size-7 text-primary-text" />
        <div className="space-y-2 border-y border-dashed border-border py-3">
          <div className="flex items-center gap-2"><Check className="size-4 text-success-text" /><span className="h-2 w-16 rounded-full bg-muted-foreground/25" /></div>
          <div className="flex items-center gap-2"><Check className="size-4 text-success-text" /><span className="h-2 w-12 rounded-full bg-muted-foreground/25" /></div>
          <div className="flex items-center gap-2"><Check className="size-4 text-success-text" /><span className="h-2 w-14 rounded-full bg-muted-foreground/25" /></div>
        </div>
        <div className="mt-3 flex justify-between gap-2"><span className="h-2 w-10 rounded-full bg-muted-foreground/25" /><span className="h-2 w-6 rounded-full bg-primary" /></div>
      </div>
      <div className="absolute top-5 right-2 flex size-14 rotate-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-sm motion-reduce:rotate-0"><Utensils className="size-7" /></div>
      <div className="absolute bottom-5 left-0 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm font-semibold shadow-sm"><Check className="size-4 text-success-text" />Minha parte</div>
      <MousePointer2 className="absolute right-9 bottom-7 size-9 fill-primary text-primary-foreground" />
    </div>
  );
}

export function RoomJoinIntro() {
  return (
    <div className="space-y-5 rounded-3xl bg-muted/70 p-5 sm:p-7 md:space-y-6 md:p-8">
      <SharedReceipt />
      <div className="space-y-2">
        <h2 className="text-2xl leading-tight font-bold tracking-tight md:text-4xl">O rolê é junto.<br /><span className="text-primary-text">A conta, cada um na sua.</span></h2>
        <p className="text-base text-muted-foreground">Na sala de itens, cada pessoa escolhe sua parte pelo próprio celular.</p>
      </div>
    </div>
  );
}

export function RoomJoinSteps() {
  return (
    <div className="rounded-3xl bg-muted/70 p-5 sm:p-7 md:col-start-1 md:row-start-2 md:p-8">
      <ol className="space-y-4" aria-label="Como funciona a sala">
        {steps.map(({ icon: Icon, title, detail }, index) => (
          <li key={title} className="flex items-start gap-3">
            <span aria-hidden="true" className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-foreground">
              <Icon className="size-5" />
              <span className="absolute -top-1 -left-1 flex size-4 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span>
            </span>
            <div className="min-w-0"><p className="text-sm font-semibold">{title}</p><p className="text-sm leading-5 text-muted-foreground">{detail}</p></div>
          </li>
        ))}
      </ol>
    </div>
  );
}
