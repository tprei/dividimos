import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPixKey } from "@/lib/crypto";
import { generatePixCopiaECola } from "@/lib/pix";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { recipientUserId, amountCents, billId } = body as {
    recipientUserId: string;
    amountCents: number;
    billId: string;
  };

  if (!recipientUserId || !amountCents || amountCents <= 0 || !billId) {
    return NextResponse.json({ error: "Dados invalidos" }, { status: 400 });
  }

  const { data: participation } = await supabase
    .from("bill_participants")
    .select("user_id")
    .eq("bill_id", billId)
    .in("user_id", [user.id, recipientUserId]);

  const callerIsParticipant = participation?.some((p) => p.user_id === user.id);
  const recipientIsParticipant = participation?.some((p) => p.user_id === recipientUserId);

  if (!callerIsParticipant || !recipientIsParticipant) {
    const { data: bill } = await supabase
      .from("bills")
      .select("creator_id")
      .eq("id", billId)
      .single();

    if (bill?.creator_id !== user.id) {
      return NextResponse.json(
        { error: "Acesso negado — voces nao participam da mesma conta" },
        { status: 403 },
      );
    }
  }

  const { data: recipientStatus } = await supabase
    .from("bill_participants")
    .select("status")
    .eq("bill_id", billId)
    .eq("user_id", recipientUserId)
    .single();

  if (recipientStatus?.status && recipientStatus.status !== "accepted") {
    return NextResponse.json(
      { error: "Participante ainda nao aceitou o convite" },
      { status: 403 },
    );
  }

  const admin = createAdminClient();
  const { data: recipient } = await admin
    .from("users")
    .select("pix_key_encrypted, name")
    .eq("id", recipientUserId)
    .single();

  if (!recipient?.pix_key_encrypted) {
    return NextResponse.json(
      { error: "Destinatario sem chave Pix configurada" },
      { status: 404 },
    );
  }

  const pixKey = decryptPixKey(recipient.pix_key_encrypted);

  const copiaECola = generatePixCopiaECola({
    pixKey,
    merchantName: recipient.name,
    merchantCity: "SAO PAULO",
    amountCents,
  });

  return NextResponse.json({ copiaECola });
}
