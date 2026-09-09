"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, DollarSign, Receipt } from "lucide-react";

import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import { PixQrModal } from "@/components/settlement/pix-qr-modal";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { ChatMessage, UserProfile } from "@/types/ledger";

import {
  CONVERSATIONS,
  GROUPS,
  ME,
  PEOPLE,
  PIX_KEYS,
  personById,
} from "../fixtures";
import type { ScreenProps } from "../mobile-preview";
import { PreviewShell } from "../preview-shell";
import { Money } from "../ui/money";

const DEFAULT_SECTION = "c_carlos";
const SEND_BASE_MS = new Date("2026-09-09T20:00:00").getTime();
const BILL_ITEMIZED_HREF = "/demo/mobile/bill-itemized";

interface ExpenseShare {
  label: string;
  cents: number;
  own?: boolean;
}

type TimelineEvent =
  | { kind: "separator"; key: string; label: string }
  | {
      kind: "expense";
      key: string;
      time: string;
      title: string;
      totalCents: number;
      subtitle: string;
      shares: ExpenseShare[];
      payCents: number | null;
      payeeId: string | null;
    }
  | { kind: "payment"; key: string; time: string; subtitle: string; amountCents: number }
  | { kind: "message"; key: string; time: string; message: ChatMessage };

type ExpenseEvent = Extract<TimelineEvent, { kind: "expense" }>;
type PaymentTimelineEvent = Extract<TimelineEvent, { kind: "payment" }>;
type MessageTimelineEvent = Extract<TimelineEvent, { kind: "message" }>;

function fixtureMessage(
  key: string,
  groupId: string,
  sender: UserProfile,
  content: string,
  date: string,
  time: string,
): ChatMessage {
  return {
    id: `fixture-${key}`,
    clientId: `fixture-${key}`,
    groupId,
    senderId: sender.id,
    content,
    createdAt: `${date}T${time}:00`,
    sender,
  };
}

const THREADS: Record<string, { events: TimelineEvent[] }> = {
  c_carlos: {
    events: [
      { kind: "separator", key: "s1", label: "Ontem" },
      {
        kind: "expense",
        key: "e1",
        time: "21:04",
        title: "Churras do Ap 42",
        totalCents: 31800,
        subtitle: "Empório do Bairro · Carlos pagou",
        shares: [
          { label: "Sua parte", cents: 10600, own: true },
          { label: "Bia", cents: 10600 },
          { label: "Carlos", cents: 10600 },
        ],
        payCents: 5900,
        payeeId: PEOPLE.carlos.id,
      },
      {
        kind: "message",
        key: "m1",
        time: "21:14",
        message: fixtureMessage(
          "c_carlos_1",
          "c_carlos",
          PEOPLE.carlos,
          "coloquei o couvert e a taxa do garçom, dá uma olhada",
          "2026-09-08",
          "21:14",
        ),
      },
      { kind: "separator", key: "s2", label: "Hoje" },
      {
        kind: "payment",
        key: "p1",
        time: "09:32",
        subtitle: "você pagou · confirmado por Carlos",
        amountCents: 4700,
      },
      {
        kind: "message",
        key: "m2",
        time: "19:42",
        message: fixtureMessage(
          "c_carlos_2",
          "c_carlos",
          PEOPLE.carlos,
          "bora acertar o churras?",
          "2026-09-09",
          "19:42",
        ),
      },
    ],
  },
  c_churras: {
    events: [
      { kind: "separator", key: "s1", label: "Ontem" },
      {
        kind: "expense",
        key: "e1",
        time: "21:04",
        title: "Churras do Ap 42",
        totalCents: 32000,
        subtitle: "Empório do Bairro · Carlos pagou",
        shares: [
          { label: "Sua parte", cents: 8000, own: true },
          { label: "Bia", cents: 8000 },
          { label: "Carlos", cents: 8000 },
          { label: "Dan", cents: 8000 },
        ],
        payCents: 8000,
        payeeId: PEOPLE.carlos.id,
      },
      {
        kind: "message",
        key: "m1",
        time: "21:14",
        message: fixtureMessage(
          "c_churras_1",
          "c_churras",
          PEOPLE.carlos,
          "coloquei o couvert e a taxa do garçom, dá uma olhada",
          "2026-09-08",
          "21:14",
        ),
      },
      { kind: "separator", key: "s2", label: "Hoje" },
      {
        kind: "payment",
        key: "p1",
        time: "09:32",
        subtitle: "Bia pagou · confirmado por Carlos",
        amountCents: 8000,
      },
      {
        kind: "message",
        key: "m2",
        time: "09:40",
        message: fixtureMessage(
          "c_churras_2",
          "c_churras",
          PEOPLE.bia,
          "fechei a minha parte no Pix, valeu!",
          "2026-09-09",
          "09:40",
        ),
      },
      {
        kind: "message",
        key: "m3",
        time: "19:42",
        message: fixtureMessage(
          "c_churras_3",
          "c_churras",
          PEOPLE.carlos,
          "bora acertar o churras?",
          "2026-09-09",
          "19:42",
        ),
      },
    ],
  },
  c_bia: {
    events: [
      { kind: "separator", key: "s1", label: "Ontem" },
      {
        kind: "expense",
        key: "e1",
        time: "12:40",
        title: "Churras do Ap 42",
        totalCents: 6300,
        subtitle: "Empório do Bairro · Bia pagou",
        shares: [
          { label: "Sua parte", cents: 2100, own: true },
          { label: "Bia", cents: 2100 },
          { label: "Dan", cents: 2100 },
        ],
        payCents: 2100,
        payeeId: PEOPLE.bia.id,
      },
      {
        kind: "message",
        key: "m1",
        time: "13:05",
        message: fixtureMessage(
          "c_bia_1",
          "c_bia",
          PEOPLE.bia,
          "Manda a conta que eu fecho",
          "2026-09-08",
          "13:05",
        ),
      },
      { kind: "separator", key: "s2", label: "Hoje" },
      {
        kind: "message",
        key: "m2",
        time: "10:16",
        message: fixtureMessage("c_bia_2", "c_bia", ME, "Fechado!", "2026-09-09", "10:16"),
      },
    ],
  },
  c_dan: {
    events: [
      { kind: "separator", key: "s1", label: "Ontem" },
      {
        kind: "message",
        key: "m1",
        time: "13:05",
        message: fixtureMessage(
          "c_dan_1",
          "c_dan",
          PEOPLE.dan,
          "Vou te pagar hoje, esquece",
          "2026-09-08",
          "13:05",
        ),
      },
      { kind: "separator", key: "s2", label: "Hoje" },
      {
        kind: "expense",
        key: "e1",
        time: "11:20",
        title: "Viagem Serra — Combustível",
        totalCents: 9000,
        subtitle: "Posto da Serra · você pagou",
        shares: [
          { label: "Sua parte", cents: 4500, own: true },
          { label: "Dan", cents: 4500 },
        ],
        payCents: null,
        payeeId: null,
      },
      {
        kind: "message",
        key: "m2",
        time: "11:46",
        message: fixtureMessage("c_dan_2", "c_dan", ME, "Beleza, fico no aguardo.", "2026-09-09", "11:46"),
      },
    ],
  },
  c_marina: {
    events: [
      { kind: "separator", key: "s1", label: "Hoje" },
      {
        kind: "expense",
        key: "e1",
        time: "09:30",
        title: "Cinema sexta — Pipoca",
        totalCents: 3600,
        subtitle: "Cineplex · você pagou",
        shares: [
          { label: "Sua parte", cents: 1800, own: true },
          { label: "Marina", cents: 1800 },
        ],
        payCents: null,
        payeeId: null,
      },
      {
        kind: "message",
        key: "m1",
        time: "09:41",
        message: fixtureMessage(
          "c_marina_1",
          "c_marina",
          PEOPLE.marina,
          "Te pago na sexta, viu?",
          "2026-09-09",
          "09:41",
        ),
      },
    ],
  },
  c_rafael: {
    events: [
      { kind: "separator", key: "s1", label: "Ontem" },
      {
        kind: "message",
        key: "m1",
        time: "18:00",
        message: fixtureMessage(
          "c_rafael_1",
          "c_rafael",
          ME,
          "Bora no bar sexta?",
          "2026-09-08",
          "18:00",
        ),
      },
      {
        kind: "message",
        key: "m2",
        time: "18:05",
        message: fixtureMessage(
          "c_rafael_2",
          "c_rafael",
          PEOPLE.rafael,
          "Boa, obrigado!",
          "2026-09-08",
          "18:05",
        ),
      },
    ],
  },
  c_serra: {
    events: [
      { kind: "separator", key: "s1", label: "Ontem" },
      {
        kind: "message",
        key: "m1",
        time: "12:00",
        message: fixtureMessage(
          "c_serra_1",
          "c_serra",
          PEOPLE.rafael,
          "Reservei a pousada, confirma aí",
          "2026-09-08",
          "12:00",
        ),
      },
      {
        kind: "message",
        key: "m2",
        time: "12:03",
        message: fixtureMessage("c_serra_2", "c_serra", ME, "Confirmei!", "2026-09-08", "12:03"),
      },
      {
        kind: "expense",
        key: "e1",
        time: "20:10",
        title: "Pousada Pedra Azul",
        totalCents: 9000,
        subtitle: "Pousada Pedra Azul · você pagou",
        shares: [
          { label: "Sua parte", cents: 4500, own: true },
          { label: "Dan", cents: 4500 },
        ],
        payCents: null,
        payeeId: null,
      },
    ],
  },
  c_cinema: {
    events: [
      { kind: "separator", key: "s1", label: "Hoje" },
      {
        kind: "message",
        key: "m1",
        time: "09:41",
        message: fixtureMessage(
          "c_cinema_1",
          "c_cinema",
          PEOPLE.marina,
          "Comprei os ingressos",
          "2026-09-09",
          "09:41",
        ),
      },
      {
        kind: "expense",
        key: "e1",
        time: "09:42",
        title: "Ingressos Cinema sexta",
        totalCents: 3600,
        subtitle: "Cineplex · você pagou",
        shares: [
          { label: "Sua parte", cents: 1800, own: true },
          { label: "Marina", cents: 1800 },
        ],
        payCents: null,
        payeeId: null,
      },
      {
        kind: "message",
        key: "m2",
        time: "09:45",
        message: fixtureMessage("c_cinema_2", "c_cinema", ME, "Manda o Pix!", "2026-09-09", "09:45"),
      },
    ],
  },
};

async function previewMarkPaid(): Promise<void> {
  throw new Error("Esta prévia não registra pagamentos.");
}

interface PayTarget {
  payeeId: string;
  amountCents: number;
  pixKey: string;
}

interface PixModalState {
  pixKey: string;
  recipientName: string;
  amountCents: number;
}

function RailRow({
  time,
  dot,
  children,
}: {
  time: string;
  dot: "expense" | "payment" | "message";
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2.5 pb-3">
      <div className="w-[46px] flex-none pt-0.5 text-right">
        <p className="font-mono text-[10.5px] leading-none text-muted-foreground">{time}</p>
      </div>
      <div className="relative w-px flex-none bg-border">
        <span
          className={cn(
            "absolute rounded-full",
            dot === "expense" && "-left-[3px] top-1.5 size-[7px] bg-primary",
            dot === "payment" && "-left-[3px] top-1.5 size-[7px] bg-success",
            dot === "message" && "-left-[2px] top-2 size-[5px] bg-border",
          )}
        />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function DatePill({ label }: { label: string }) {
  return (
    <div className="flex justify-center pb-3">
      <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] font-semibold text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function ExpenseCard({
  event,
  onPay,
}: {
  event: ExpenseEvent;
  onPay: (target: PayTarget) => void;
}) {
  const payeeId = event.payeeId;
  const pixKey = payeeId === null ? undefined : PIX_KEYS[payeeId];
  const payTarget: PayTarget | null =
    event.payCents !== null && payeeId !== null && pixKey !== undefined
      ? { payeeId, amountCents: event.payCents, pixKey }
      : null;
  return (
    <div className="rounded-[18px] border bg-card p-3">
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-bold">{event.title}</p>
        <Money cents={event.totalCents} className="flex-none text-sm" />
      </div>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{event.subtitle}</p>
      <div className="mt-2 flex flex-col gap-1 border-t border-dashed pt-2">
        {event.shares.map((share) => (
          <div key={share.label} className="flex">
            <span className="flex-1 text-xs text-muted-foreground">{share.label}</span>
            <Money cents={share.cents} className={cn("text-xs", share.own && "font-semibold")} />
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex gap-[7px]">
        {payTarget && (
          <Button
            size="sm"
            className="h-7 rounded-[10px] px-3 text-xs font-extrabold"
            onClick={() => onPay(payTarget)}
          >
            Pagar {formatBRL(payTarget.amountCents)}
          </Button>
        )}
        <Link
          href={BILL_ITEMIZED_HREF}
          className="flex h-7 items-center rounded-[10px] border border-border px-3 text-xs font-bold text-muted-foreground"
        >
          Ver conta
        </Link>
      </div>
    </div>
  );
}

function PaymentEvent({ event }: { event: PaymentTimelineEvent }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[18px] border border-success/25 bg-success/10 px-3 py-[11px]">
      <span className="flex size-[26px] flex-none items-center justify-center rounded-full bg-success/20 text-success">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-bold leading-tight">Pagamento registrado</p>
        <p className="truncate text-[11px] text-muted-foreground">{event.subtitle}</p>
      </div>
      <Money cents={event.amountCents} className="flex-none text-[13.5px] text-success" />
    </div>
  );
}

function MessageEvent({
  event,
  isGroup,
}: {
  event: MessageTimelineEvent;
  isGroup: boolean;
}) {
  return (
    <ChatMessageBubble
      message={event.message}
      isOwn={event.message.senderId === ME.id}
      showAvatar={isGroup}
    />
  );
}

function BackToConversations() {
  return (
    <Link
      href="/demo/mobile/conversations"
      aria-label="Voltar para conversas"
      className="-m-1 flex flex-none p-1 text-muted-foreground"
    >
      <ArrowLeft className="size-5" />
    </Link>
  );
}

export function ChatScreen({ section }: ScreenProps) {
  const conversation =
    section === null
      ? CONVERSATIONS.find((item) => item.id === DEFAULT_SECTION)
      : CONVERSATIONS.find((item) => item.id === section);
  const conversationId = conversation?.id ?? null;
  const [sentByThread, setSentByThread] = useState<Record<string, ChatMessage[]>>({});
  const [pix, setPix] = useState<PixModalState | null>(null);

  async function handleSend(content: string): Promise<void> {
    if (conversationId === null) return;
    setSentByThread((prev) => {
      const seq = (prev[conversationId]?.length ?? 0) + 1;
      const id = `local-${conversationId}-${seq}`;
      const message: ChatMessage = {
        id,
        clientId: id,
        groupId: conversationId,
        senderId: ME.id,
        content,
        createdAt: new Date(SEND_BASE_MS + seq * 60_000).toISOString(),
        sender: ME,
      };
      return { ...prev, [conversationId]: [...(prev[conversationId] ?? []), message] };
    });
  }

  if (!conversation) {
    return (
      <PreviewShell nav={null}>
        <div className="flex h-full flex-col">
          <header className="flex flex-none items-center border-b bg-card px-3 py-3">
            <BackToConversations />
          </header>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-bold">Conversa não encontrada</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{section}</p>
            <Link
              href="/demo/mobile/conversations"
              className="text-xs font-bold text-primary underline-offset-4 hover:underline"
            >
              Voltar para conversas
            </Link>
          </div>
        </div>
      </PreviewShell>
    );
  }

  const thread = THREADS[conversation.id];
  const isGroup = conversation.kind === "group";
  const group = isGroup ? GROUPS.find((item) => item.name === conversation.name) : undefined;
  const counterparty =
    isGroup || conversation.counterpartyId === undefined
      ? undefined
      : personById(conversation.counterpartyId);
  let subtitle: string;
  if (isGroup) {
    subtitle = group ? `${group.memberIds.length} membros` : conversation.name;
  } else {
    subtitle = counterparty ? `@${counterparty.handle}` : conversation.name;
  }
  const netCents = conversation.netCents;
  const receivableCents = Math.max(netCents, 0);
  const sent = sentByThread[conversation.id] ?? [];

  const openPay = (target: PayTarget) => {
    const payee = Object.values(PEOPLE).find((item) => item.id === target.payeeId);
    if (!payee) return;
    setPix({
      pixKey: target.pixKey,
      recipientName: payee.name,
      amountCents: target.amountCents,
    });
  };

  return (
    <PreviewShell nav={null}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-none items-center gap-[11px] border-b bg-card px-3 py-3">
          <BackToConversations />
          <UserAvatar name={conversation.avatarName} size="sm" className="h-[34px] w-[34px] text-[12px]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-bold leading-tight">{conversation.name}</p>
            <p className="truncate text-[11.5px] text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex-none text-right">
            <Money
              cents={Math.abs(netCents)}
              className={cn(
                "text-[15px]",
                netCents < 0 && "text-destructive",
                netCents > 0 && "text-success",
              )}
            />
            <p className="text-[10px] font-bold text-muted-foreground">
              {netCents < 0 ? "VOCÊ DEVE" : netCents > 0 ? "VOCÊ RECEBE" : "EM DIA"}
            </p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col justify-end px-3.5 pt-3.5">
            {thread.events.map((event) => {
              if (event.kind === "separator") {
                return <DatePill key={event.key} label={event.label} />;
              }
              if (event.kind === "expense") {
                return (
                  <RailRow key={event.key} time={event.time} dot="expense">
                    <ExpenseCard event={event} onPay={openPay} />
                  </RailRow>
                );
              }
              if (event.kind === "payment") {
                return (
                  <RailRow key={event.key} time={event.time} dot="payment">
                    <PaymentEvent event={event} />
                  </RailRow>
                );
              }
              return (
                <RailRow key={event.key} time={event.time} dot="message">
                  <MessageEvent event={event} isGroup={isGroup} />
                </RailRow>
              );
            })}
            {sent.map((message) => (
              <RailRow
                key={message.id}
                time={new Date(message.createdAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                dot="message"
              >
                <ChatMessageBubble message={message} isOwn showAvatar={isGroup} />
              </RailRow>
            ))}
          </div>
        </div>
        <div className="flex-none border-t bg-card px-3 pt-2.5 pb-3">
          <div className="mb-2 flex gap-2">
            {counterparty && receivableCents > 0 && (
              <Link
                href={`/demo/mobile/home?sheet=pix-collect&section=${counterparty.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
              >
                <DollarSign className="size-[13px]" />
                Cobrar {formatBRL(receivableCents)}
              </Link>
            )}
            <Link
              href={BILL_ITEMIZED_HREF}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
            >
              <Receipt className="size-[13px]" />
              Dividir conta
            </Link>
          </div>
          <ChatInput onSend={handleSend} />
        </div>
      </div>
      {pix && (
        <PixQrModal
          open
          onClose={() => setPix(null)}
          recipientName={pix.recipientName}
          amountCents={pix.amountCents}
          mode="pay"
          pixKey={pix.pixKey}
          onMarkPaid={previewMarkPaid}
        />
      )}
    </PreviewShell>
  );
}
