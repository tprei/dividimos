import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPixKey } from "@/lib/crypto";
import { generatePixCopiaECola } from "@/lib/pix";
import { jsonResponse } from "../response";

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const callerId =
    !claimsError && claimsData?.claims?.sub
      ? (claimsData.claims.sub as string)
      : null;
  if (!callerId) {
    return jsonResponse({ error: "Não autenticado" }, 401);
  }

  const body = await request.json();
  const { amountCents } = body as { amountCents: number };

  if (
    !amountCents ||
    amountCents <= 0 ||
    !Number.isInteger(amountCents) ||
    amountCents > 100_000_00
  ) {
    return jsonResponse({ error: "Valor invalido" }, 400);
  }

  const admin = createAdminClient();
  const { data: userData } = await admin
    .from("users")
    .select("pix_key_encrypted, name")
    .eq("id", callerId)
    .single();

  if (!userData?.pix_key_encrypted) {
    return jsonResponse({ error: "Voce nao tem chave Pix configurada" }, 404);
  }

  let pixKey: string;
  try {
    pixKey = decryptPixKey(userData.pix_key_encrypted);
  } catch {
    return jsonResponse({ error: "Erro ao processar sua chave Pix" }, 500);
  }

  const copiaECola = generatePixCopiaECola({
    pixKey,
    merchantName: userData.name,
    merchantCity: "SAO PAULO",
    amountCents,
  });

  return jsonResponse({ copiaECola }, 200);
}
