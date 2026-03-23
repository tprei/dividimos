"use client";

import { Bug } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useBillStore } from "@/stores/bill-store";
import type { BillType, User } from "@/types";

const TEST_USERS: User[] = [
  { id: "test_ana", name: "Ana Silva", phone: "+5511999001001", pixKey: "+5511999001001", pixKeyType: "phone", createdAt: new Date().toISOString() },
  { id: "test_marcos", name: "Marcos Oliveira", phone: "+5511999002002", pixKey: "+5511999002002", pixKeyType: "phone", createdAt: new Date().toISOString() },
  { id: "test_julia", name: "Julia Santos", phone: "+5511999003003", pixKey: "julia@email.com", pixKeyType: "email", createdAt: new Date().toISOString() },
  { id: "test_lucas", name: "Lucas Costa", phone: "+5511999004004", pixKey: "+5511999004004", pixKeyType: "phone", createdAt: new Date().toISOString() },
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

  const fillMultiPayer = () => {
    const s = useBillStore.getState();
    const grandTotal = s.getGrandTotal();
    const participants = s.participants;
    if (participants.length < 2) return;
    const half = Math.floor(grandTotal / 2);
    store.setPayerAmount(participants[0].id, half);
    store.setPayerAmount(participants[1].id, grandTotal - half);
  };

  const fillSingleBillEqual = () => {
    const participants = useBillStore.getState().participants;
    store.updateBill({ totalAmountInput: 30000, totalAmount: 30000 });
    setTimeout(() => {
      store.splitBillEqually(participants.map((p) => p.id));
    }, 50);
  };

  const fillComplexScenario = () => {
    store.setCurrentUser({
      id: "test_self", name: "Pedro Reis", phone: "+5511987654321",
      pixKey: "+5511987654321", pixKeyType: "phone", createdAt: new Date().toISOString(),
    });
    store.createBill("Churrascaria Teste", "itemized", "Fogo de Chao");
    store.updateBill({ serviceFeePercent: 10, fixedFees: 0 });
    for (const user of TEST_USERS) store.addParticipant(user);
    for (const item of RESTAURANT_ITEMS) store.addItem(item);

    const s = useBillStore.getState();
    const items = s.items;
    const pIds = s.participants.map((p) => p.id);
    store.splitItemEqually(items[0].id, [pIds[0], pIds[1]]);
    store.splitItemEqually(items[1].id, [pIds[2], pIds[3]]);
    store.splitItemEqually(items[2].id, pIds);
    store.splitItemEqually(items[3].id, [pIds[0]]);
    store.splitItemEqually(items[4].id, pIds);

    const gt = useBillStore.getState().getGrandTotal();
    store.setPayerAmount(pIds[0], Math.floor(gt * 0.6));
    store.setPayerAmount(pIds[2], gt - Math.floor(gt * 0.6));

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
          <Button size="sm" variant="outline" className="w-full text-xs justify-start" onClick={fillMultiPayer}>Multi-pagador (50/50)</Button>
          <Button size="sm" variant="outline" className="w-full text-xs justify-start" onClick={fillSingleBillEqual}>Valor unico R$300 igual</Button>
          <Button size="sm" variant="outline" className="w-full text-xs justify-start text-destructive" onClick={fillComplexScenario}>Cenario completo + ledger</Button>
          <Button size="sm" variant="ghost" className="w-full text-xs justify-start text-muted-foreground" onClick={() => store.reset()}>Resetar tudo</Button>
        </div>
      )}
    </div>
  );
}
