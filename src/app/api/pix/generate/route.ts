import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

  if (!recipientUserId || !amountCents || amountCents <= 0) {
    return NextResponse.json({ error: "Dados invalidos" }, { status: 400 });
  }

  if (billId) {
    const { data: participation } = await supabase
      .from("bill_participants")
      .select("user_id")
      .eq("bill_id", billId)
      .in("user_id", [user.id, recipientUserId]);

    if (!participation || participation.length < 2) {
      const { data: bill } = await supabase
        .from("bills")
        .select("creator_id")
        .eq("id", billId)
        .single();

      const isCreator = bill?.creator_id === user.id;
      if (!isCreator) {
        return NextResponse.json(
          { error: "Acesso negado a esta conta" },
          { status: 403 },
        );
      }
    }
  }

  const { data: recipient } = await supabase
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
