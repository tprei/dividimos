import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { evaluateServerFinancialGate } from "@/lib/financial-compatibility";
import { RoomCodeEntryPage } from "./room-code-entry-page";

export const metadata: Metadata = {
  title: "Entrar na sala",
  description: "Digite o código que alguém da mesa falou.",
};

export default async function RoomCodeEntryRoute() {
  const gate = evaluateServerFinancialGate();
  if (!gate.compatible) {
    redirect(`/manutencao?reason=${encodeURIComponent(gate.issue.code)}`);
  }

  return <RoomCodeEntryPage />;
}
