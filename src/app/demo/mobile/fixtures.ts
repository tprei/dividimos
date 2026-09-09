import type { DebtRow } from "@/lib/ledger/debt-rows";
import type { DebtEdge } from "@/lib/simplify";
import type { UserProfile } from "@/types/ledger";

function person(id: string, handle: string, name: string): UserProfile {
  return { id, handle, name, avatarUrl: null };
}

export const PEOPLE = {
  tiago: person("u_tiago", "tiago", "Tiago Rocha"),
  bia: person("u_bia", "bia", "Bia Ferreira"),
  carlos: person("u_carlos", "carlos", "Carlos Andrade"),
  dan: person("u_dan", "dan", "Dan Souza"),
  marina: person("u_marina", "marina", "Marina Costa"),
  rafael: person("u_rafael", "rafael", "Rafael Nunes"),
} as const;

export const ME: UserProfile = PEOPLE.tiago;

export const GUEST_MARIA = { id: "guest_maria", name: "Maria" } as const;

export function personById(id: string): UserProfile {
  const match = Object.values(PEOPLE).find((p) => p.id === id);
  if (!match) throw new Error(`Unknown fixture person: ${id}`);
  return match;
}

export function firstName(profile: UserProfile): string {
  return profile.name.split(" ")[0];
}

export interface GroupFixture {
  id: string;
  name: string;
  memberIds: string[];
  billCount: number;
  myNetCents: number;
}

export const GROUPS: GroupFixture[] = [
  {
    id: "g_churras",
    name: "Churras do Ap 42",
    memberIds: [PEOPLE.tiago.id, PEOPLE.bia.id, PEOPLE.carlos.id, PEOPLE.dan.id],
    billCount: 6,
    myNetCents: -8000,
  },
  {
    id: "g_serra",
    name: "Viagem Serra",
    memberIds: [
      PEOPLE.tiago.id,
      PEOPLE.bia.id,
      PEOPLE.dan.id,
      PEOPLE.rafael.id,
      PEOPLE.marina.id,
    ],
    billCount: 9,
    myNetCents: 4500,
  },
  {
    id: "g_cinema",
    name: "Cinema sexta",
    memberIds: [PEOPLE.tiago.id, PEOPLE.marina.id, PEOPLE.rafael.id],
    billCount: 3,
    myNetCents: 1800,
  },
];

export const GROUP_INVITE = {
  id: "g_apto42",
  name: "Apto 42",
  invitedBy: PEOPLE.marina,
} as const;

function debtRow(
  group: GroupFixture,
  counterparty: UserProfile,
  amountCents: number,
  direction: DebtRow["direction"],
): DebtRow {
  return {
    groupId: group.id,
    groupName: group.name,
    isDm: false,
    counterpartyKind: "user",
    counterpartyId: counterparty.id,
    counterpartyName: counterparty.name,
    counterpartyAvatarUrl: null,
    amountCents,
    direction,
  };
}

export const DEBT_ROWS: DebtRow[] = [
  debtRow(GROUPS[0], PEOPLE.carlos, 5900, "owes"),
  debtRow(GROUPS[0], PEOPLE.bia, 2100, "owes"),
  debtRow(GROUPS[1], PEOPLE.dan, 4500, "owed"),
  debtRow(GROUPS[2], PEOPLE.marina, 1800, "owed"),
];

export const HOME_NET_CENTS = -1700;
export const HOME_OWES_CENTS = 8000;
export const HOME_OWED_CENTS = 6300;

export interface ConversationFixture {
  id: string;
  kind: "dm" | "group";
  counterpartyId?: string;
  name: string;
  avatarName: string;
  speaker: UserProfile;
  preview: string;
  time: string;
  netCents: number;
  unread: number;
}

export const CONVERSATIONS: ConversationFixture[] = [
  {
    id: "c_carlos",
    kind: "dm",
    counterpartyId: PEOPLE.carlos.id,
    name: "Carlos",
    avatarName: PEOPLE.carlos.name,
    speaker: PEOPLE.carlos,
    preview: "Fechou, manda o valor",
    time: "14:32",
    netCents: -5900,
    unread: 2,
  },
  {
    id: "c_churras",
    kind: "group",
    name: "Churras do Ap 42",
    avatarName: "Churras",
    speaker: PEOPLE.carlos,
    preview: "Adicionei a picanha na conta",
    time: "12:18",
    netCents: -8000,
    unread: 3,
  },
  {
    id: "c_dan",
    kind: "dm",
    counterpartyId: PEOPLE.dan.id,
    name: "Dan",
    avatarName: PEOPLE.dan.name,
    speaker: PEOPLE.dan,
    preview: "Vou te pagar hoje, esquece",
    time: "13:05",
    netCents: 4500,
    unread: 1,
  },
  {
    id: "c_bia",
    kind: "dm",
    counterpartyId: PEOPLE.bia.id,
    name: "Bia",
    avatarName: PEOPLE.bia.name,
    speaker: PEOPLE.tiago,
    preview: "Manda a conta que eu fecho",
    time: "qui",
    netCents: -2100,
    unread: 0,
  },
  {
    id: "c_serra",
    kind: "group",
    name: "Viagem Serra",
    avatarName: "Viagem Serra",
    speaker: PEOPLE.rafael,
    preview: "Reservei a pousada, confirma aí",
    time: "seg",
    netCents: 4500,
    unread: 0,
  },
  {
    id: "c_cinema",
    kind: "group",
    name: "Cinema sexta",
    avatarName: "Cinema Sexta",
    speaker: PEOPLE.marina,
    preview: "Comprei os ingressos",
    time: "09:41",
    netCents: 1800,
    unread: 1,
  },
  {
    id: "c_marina",
    kind: "dm",
    counterpartyId: PEOPLE.marina.id,
    name: "Marina",
    avatarName: PEOPLE.marina.name,
    speaker: PEOPLE.marina,
    preview: "Te pago na sexta, viu?",
    time: "ter",
    netCents: 1800,
    unread: 0,
  },
  {
    id: "c_rafael",
    kind: "dm",
    counterpartyId: PEOPLE.rafael.id,
    name: "Rafael",
    avatarName: PEOPLE.rafael.name,
    speaker: PEOPLE.tiago,
    preview: "Boa, obrigado!",
    time: "seg",
    netCents: 0,
    unread: 0,
  },
];

export interface ItemFixture {
  id: string;
  name: string;
  cents: number;
  assigneeIds: string[];
}

const TRIO = [PEOPLE.tiago.id, PEOPLE.bia.id, PEOPLE.carlos.id];

export const ITEMS: ItemFixture[] = [
  { id: "i_picanha", name: "Picanha", cents: 12900, assigneeIds: TRIO },
  { id: "i_chopp", name: "Chopp", cents: 4200, assigneeIds: TRIO },
  { id: "i_fritas", name: "Fritas", cents: 3800, assigneeIds: TRIO },
  { id: "i_linguica", name: "Linguiça", cents: 4500, assigneeIds: [] },
];

export const SERVICE_FEE_CENTS = 3510;
export const ITEMIZED_TOTAL_CENTS = 28910;
export const RECEIPT_DATE_BR = "09/09/2026";
export const ITEMIZED_PARTICIPANT_IDS: string[] = [
  PEOPLE.tiago.id,
  PEOPLE.bia.id,
  PEOPLE.carlos.id,
  PEOPLE.dan.id,
  GUEST_MARIA.id,
];

export const SINGLE_BILL = {
  title: "Airbnb do fim de semana",
  group: "Viagem Serra",
  totalCents: 24000,
  payerId: PEOPLE.tiago.id,
  participantIds: [PEOPLE.tiago.id, PEOPLE.bia.id, PEOPLE.dan.id, PEOPLE.rafael.id],
  equalShareCents: 6000,
  dateIso: "2026-09-09",
} as const;

export const BALANCES: { userId: string; netCents: number }[] = [
  { userId: PEOPLE.tiago.id, netCents: -8000 },
  { userId: PEOPLE.bia.id, netCents: 2100 },
  { userId: PEOPLE.carlos.id, netCents: 14900 },
  { userId: PEOPLE.dan.id, netCents: -9000 },
];

export const SETTLEMENT_PARTICIPANTS: UserProfile[] = [
  PEOPLE.tiago,
  PEOPLE.bia,
  PEOPLE.carlos,
  PEOPLE.dan,
];

export const TRANSFERS: DebtEdge[] = [
  { fromUserId: PEOPLE.tiago.id, toUserId: PEOPLE.carlos.id, amountCents: 5900 },
  { fromUserId: PEOPLE.tiago.id, toUserId: PEOPLE.bia.id, amountCents: 2100 },
  { fromUserId: PEOPLE.dan.id, toUserId: PEOPLE.carlos.id, amountCents: 9000 },
];

export const ORIGINAL_TRANSFERS: DebtEdge[] = [
  { fromUserId: PEOPLE.tiago.id, toUserId: PEOPLE.carlos.id, amountCents: 7000 },
  { fromUserId: PEOPLE.tiago.id, toUserId: PEOPLE.bia.id, amountCents: 1000 },
  { fromUserId: PEOPLE.dan.id, toUserId: PEOPLE.carlos.id, amountCents: 7900 },
  { fromUserId: PEOPLE.dan.id, toUserId: PEOPLE.bia.id, amountCents: 1100 },
];

export interface ShareFixture {
  id: string;
  name: string;
  cents: number;
  guest: boolean;
}

export const CREATED_BILL = {
  title: "Churras do Ap 42",
  totalCents: 28910,
  payerId: PEOPLE.tiago.id,
  shares: [
    { id: PEOPLE.tiago.id, name: PEOPLE.tiago.name, cents: 7979, guest: false },
    { id: PEOPLE.bia.id, name: PEOPLE.bia.name, cents: 4951, guest: false },
    { id: PEOPLE.carlos.id, name: PEOPLE.carlos.name, cents: 9732, guest: false },
    { id: GUEST_MARIA.id, name: GUEST_MARIA.name, cents: 6248, guest: true },
  ] satisfies ShareFixture[],
};

export const PIX_KEYS: Record<string, string> = {
  [PEOPLE.tiago.id]: "tiago@example.invalid",
  [PEOPLE.bia.id]: "bia@example.invalid",
  [PEOPLE.carlos.id]: "carlos@example.invalid",
};
export const CLAIM_TOKEN_PREVIEW = "gst1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
