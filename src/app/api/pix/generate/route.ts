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
  const { recipientUserId, amountCents, billId, groupId } = body as {
    recipientUserId: string;
    amountCents: number;
    billId?: string;
    groupId?: string;
  };

  if (!recipientUserId || !amountCents || amountCents <= 0 || (!billId && !groupId)) {
    return NextResponse.json({ error: "Dados invalidos" }, { status: 400 });
  }

  const admin = createAdminClient();
  let recipient: { pix_key_encrypted: string | null; name: string } | null = null;

  if (groupId) {
    const [{ data: memberRows }, { data: groupRow }, { data: recipientData }] = await Promise.all([
      supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .in("user_id", [user.id, recipientUserId]),
      supabase.from("groups").select("creator_id").eq("id", groupId).single(),
      admin.from("users").select("pix_key_encrypted, name").eq("id", recipientUserId).single(),
    ]);

    const callerIsCreator = groupRow?.creator_id === user.id;
    const recipientIsCreator = groupRow?.creator_id === recipientUserId;
    const callerIsMember = callerIsCreator || memberRows?.some((m) => m.user_id === user.id);
    const recipientIsMember = recipientIsCreator || memberRows?.some((m) => m.user_id === recipientUserId);

    if (!callerIsMember || !recipientIsMember) {
      return NextResponse.json(
        { error: "Acesso negado — voces nao pertencem ao mesmo grupo" },
        { status: 403 },
      );
    }

    recipient = recipientData;
  } else if (billId) {
    const [{ data: participation }, { data: recipientData }] = await Promise.all([
      supabase
        .from("bill_participants")
        .select("user_id, status")
        .eq("bill_id", billId)
        .in("user_id", [user.id, recipientUserId]),
      admin.from("users").select("pix_key_encrypted, name").eq("id", recipientUserId).single(),
    ]);

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

    const recipientParticipation = participation?.find((p) => p.user_id === recipientUserId);
    if (recipientParticipation?.status && recipientParticipation.status !== "accepted") {
      return NextResponse.json(
        { error: "Participante ainda nao aceitou o convite" },
        { status: 403 },
      );
    }

    recipient = recipientData;
  }

  if (!recipient?.pix_key_encrypted) {
    return NextResponse.json(
      { error: "Destinatario sem chave Pix configurada" },
      { status: 404 },
    );
  }

  let pixKey: string;
  try {
    pixKey = decryptPixKey(recipient.pix_key_encrypted);
  } catch {
    return NextResponse.json(
      { error: "Erro ao processar chave Pix do destinatario" },
      { status: 500 },
    );
  }

  const copiaECola = generatePixCopiaECola({
    pixKey,
    merchantName: recipient.name,
    merchantCity: "SAO PAULO",
    amountCents,
  });

  return NextResponse.json({ copiaECola });
}
