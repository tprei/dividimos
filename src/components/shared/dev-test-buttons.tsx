"use client";

import { Bug } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useBillStore } from "@/stores/bill-store";
import type { User } from "@/types";

const TEST_USERS: User[] = [
  { id: "test_ana", email: "ana@test.com", handle: "ana.silva", name: "Ana Silva", pixKeyType: "email", pixKeyHint: "a***a@test.com", onboarded: true, createdAt: new Date().toISOString() },
  { id: "test_marcos", email: "marcos@test.com", handle: "marcos.oliveira", name: "Marcos Oliveira", pixKeyType: "email", pixKeyHint: "m***s@test.com", onboarded: true, createdAt: new Date().toISOString() },
  { id: "test_julia", email: "julia@test.com", handle: "julia.santos", name: "Julia Santos", pixKeyType: "email", pixKeyHint: "j****a@email.com", onboarded: true, createdAt: new Date().toISOString() },
  { id: "test_lucas", email: "lucas@test.com", handle: "lucas.costa", name: "Lucas Costa", pixKeyType: "email", pixKeyHint: "l***s@test.com", onboarded: true, createdAt: new Date().toISOString() },
];

const RESTAURANT_ITEMS = [
  { description: "Picanha 400g", quantity: 1, unitPriceCents: 8900, totalPriceCents: 8900 },
  { description: "Costela no bafo", quantity: 1, unitPriceCents: 6700, totalPriceCents: 6700 },
  { description: "Cerveja 600ml", quantity: 3, unitPriceCents: 1400, totalPriceCents: 4200 },
  { description: "Coca-Cola 600ml", quantity: 2, unitPriceCents: 1200, totalPriceCents: 2400 },
  { description: "Batata frita", quantity: 1, unitPriceCents: 3200, totalPriceCents: 3200 },
];

export function DevTestButtons() {
  const [open, setOpen] = useState(false);
  const store = useBillStore();

  if (process.env.NODE_ENV === "production") return null;

  const fillParticipants = () => {
    for (const user of TEST_USERS) {
      store.addParticipant(user);
    }
  };

  const fillItems = () => {
    for (const item of RESTAURANT_ITEMS) {
      store.addItem(item);
    }
  };

  const fillItemSplits = () => {
    const items = useBillStore.getState().items;
    const participants = useBillStore.getState().participants;
    if (items.length === 0 || participants.length === 0) return;

    store.splitItemEqually(items[0]?.id, [participants[0]?.id, participants[1]?.id].filter(Boolean));
    if (items[1]) store.splitItemEqually(items[1].id, [participants[2]?.id, participants[3]?.id].filter(Boolean));
    if (items[2]) store.splitItemEqually(items[2].id, participants.map((p) => p.id));
    if (items[3]) store.splitItemEqually(items[3].id, [participants[0]?.id].filter(Boolean));
    if (items[4]) store.splitItemEqually(items[4].id, participants.map((p) => p.id));
  };

  const fillComplexScenario = () => {
    store.setCurrentUser({
      id: "test_self", email: "pedro@test.com", handle: "pedro.reis", name: "Pedro Reis",
      pixKeyType: "email", pixKeyHint: "p***o@test.com", onboarded: true, createdAt: new Date().toISOString(),
    });
    store.createExpense("Churrascaria Teste", "itemized", "Fogo de Chao");
    store.updateExpense({ serviceFeePercent: 10, fixedFees: 0 });
    for (const user of TEST_USERS) store.addParticipant(user);
    for (const item of RESTAURANT_ITEMS) store.addItem(item);

    const s = useBillStore.getState();
    const storeItems = s.items;
    const pIds = s.participants.map((p) => p.id);

    store.splitItemEqually(storeItems[0].id, [pIds[0], pIds[1]]);
    store.splitItemEqually(storeItems[1].id, [pIds[2], pIds[3], pIds[4]]);
    store.splitItemEqually(storeItems[2].id, pIds);
    store.splitItemEqually(storeItems[3].id, [pIds[0], pIds[3]]);
    store.splitItemEqually(storeItems[4].id, [pIds[1], pIds[2], pIds[4]]);

    const gt = useBillStore.getState().getGrandTotal();
    store.setPayerAmount(pIds[1], Math.floor(gt * 0.45));
    store.setPayerAmount(pIds[3], gt - Math.floor(gt * 0.45));

    store.computeLedger();
  };

  return (
    <div className="fixed bottom-20 right-3 z-50">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg"
        >
          <Bug className="h-5 w-5" />
        </button>
      ) : (
        <div className="w-56 rounded-2xl border bg-card p-3 shadow-xl space-y-1.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-destructive">Dev Tools</span>
            <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground">fechar</button>
          </div>
          <Button size="sm" variant="outline" className="w-full text-xs justify-start" onClick={fillParticipants}>+ 4 participantes</Button>
          <Button size="sm" variant="outline" className="w-full text-xs justify-start" onClick={fillItems}>+ 5 itens restaurante</Button>
          <Button size="sm" variant="outline" className="w-full text-xs justify-start" onClick={fillItemSplits}>Atribuir itens</Button>
          <Button size="sm" variant="outline" className="w-full text-xs justify-start text-destructive" onClick={fillComplexScenario}>Cenario completo + ledger</Button>
          <Button size="sm" variant="ghost" className="w-full text-xs justify-start text-muted-foreground" onClick={() => store.reset()}>Resetar tudo</Button>
        </div>
      )}
    </div>
  );
}
