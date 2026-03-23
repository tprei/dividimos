import type { User, BillItem } from "@/types";

export const DEMO_USERS: User[] = [
  {
    id: "user_self",
    name: "Pedro Reis",
    phone: "+5511987654321",
    pixKey: "+5511987654321",
    pixKeyType: "phone",
    createdAt: new Date().toISOString(),
  },
  {
    id: "user_ana",
    name: "Ana Silva",
    phone: "+5511999887766",
    pixKey: "+5511999887766",
    pixKeyType: "phone",
    createdAt: new Date().toISOString(),
  },
  {
    id: "user_marcos",
    name: "Marcos Oliveira",
    phone: "+5511988776655",
    pixKey: "+5511988776655",
    pixKeyType: "phone",
    createdAt: new Date().toISOString(),
  },
  {
    id: "user_julia",
    name: "Julia Santos",
    phone: "+5511977665544",
    pixKey: "julia.santos@email.com",
    pixKeyType: "email",
    createdAt: new Date().toISOString(),
  },
];

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
