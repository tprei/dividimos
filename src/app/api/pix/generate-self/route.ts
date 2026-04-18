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
  const { amountCents } = body as { amountCents: number };

  if (
    !amountCents ||
    amountCents <= 0 ||
    !Number.isInteger(amountCents) ||
    amountCents > 100_000_00
  ) {
    return NextResponse.json({ error: "Valor invalido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: userData } = await admin
    .from("users")
    .select("pix_key_encrypted, name")
    .eq("id", user.id)
    .single();

  if (!userData?.pix_key_encrypted) {
    return NextResponse.json(
      { error: "Voce nao tem chave Pix configurada" },
      { status: 404 },
    );
  }

  let pixKey: string;
  try {
    pixKey = decryptPixKey(userData.pix_key_encrypted);
  } catch {
    return NextResponse.json(
      { error: "Erro ao processar sua chave Pix" },
      { status: 500 },
    );
  }

  const copiaECola = generatePixCopiaECola({
    pixKey,
    merchantName: userData.name,
    merchantCity: "SAO PAULO",
    amountCents,
  });

  return NextResponse.json({ copiaECola });
}
