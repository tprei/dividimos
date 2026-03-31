import type { User, BillItem } from "@/types";

export const DEMO_USERS: User[] = [
  {
    id: "user_self",
    email: "pedro.reis@gmail.com",
    handle: "pedro.reis",
    name: "Pedro Reis",
    pixKeyType: "email",
    pixKeyHint: "p*********s@gmail.com",
    avatarUrl: undefined,
    onboarded: true,

    createdAt: new Date().toISOString(),
  },
  {
    id: "user_ana",
    email: "ana.silva@gmail.com",
    handle: "ana.silva",
    name: "Ana Silva",
    pixKeyType: "email",
    pixKeyHint: "a********a@gmail.com",
    avatarUrl: undefined,
    onboarded: true,

    createdAt: new Date().toISOString(),
  },
  {
    id: "user_marcos",
    email: "marcos.oliveira@gmail.com",
    handle: "marcos.oliveira",
    name: "Marcos Oliveira",
    pixKeyType: "email",
    pixKeyHint: "m**************a@gmail.com",
    avatarUrl: undefined,
    onboarded: true,

    createdAt: new Date().toISOString(),
  },
  {
    id: "user_julia",
    email: "julia.santos@email.com",
    handle: "julia.santos",
    name: "Julia Santos",
    pixKeyType: "email",
    pixKeyHint: "j****s@email.com",
    avatarUrl: undefined,
    onboarded: true,

    createdAt: new Date().toISOString(),
  },
];

export const DEMO_PIX_KEYS: Record<string, string> = {
  user_self: "pedro.reis@gmail.com",
  user_ana: "ana.silva@gmail.com",
  user_marcos: "marcos.oliveira@gmail.com",
  user_julia: "julia.santos@email.com",
};

export const DEMO_ITEMS: Omit<BillItem, "id" | "billId" | "createdAt">[] = [
  {
    description: "Picanha na brasa 400g",
    quantity: 1,
    unitPriceCents: 8900,
    totalPriceCents: 8900,
  },
  {
    description: "Costela no bafo",
    quantity: 1,
    unitPriceCents: 6700,
    totalPriceCents: 6700,
  },
  {
    description: "Coca-Cola 600ml",
    quantity: 2,
    unitPriceCents: 1200,
    totalPriceCents: 2400,
  },
  {
    description: "Cerveja Brahma 600ml",
    quantity: 3,
    unitPriceCents: 1400,
    totalPriceCents: 4200,
  },
  {
    description: "Batata frita grande",
    quantity: 1,
    unitPriceCents: 3200,
    totalPriceCents: 3200,
  },
  {
    description: "Farofa especial",
    quantity: 1,
    unitPriceCents: 1800,
    totalPriceCents: 1800,
  },
  {
    description: "Vinagrete",
    quantity: 1,
    unitPriceCents: 800,
    totalPriceCents: 800,
  },
  {
    description: "Agua mineral 500ml",
    quantity: 2,
    unitPriceCents: 600,
    totalPriceCents: 1200,
  },
];
