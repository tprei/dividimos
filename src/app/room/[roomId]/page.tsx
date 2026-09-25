import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { evaluateServerFinancialGate } from "@/lib/financial-compatibility";
import { RoomPageClient } from "./room-page-client";

const ROOM_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: "Sala de itens | Dividimos",
  description: "Cada um marca o que consumiu e a conta fecha sozinha.",
};

export default async function AssignmentRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  if (!ROOM_ID_RE.test(roomId)) notFound();

  const gate = evaluateServerFinancialGate();
  if (!gate.compatible) {
    redirect(`/manutencao?reason=${encodeURIComponent(gate.issue.code)}`);
  }

  return <RoomPageClient roomId={roomId.toLowerCase()} />;
}
