import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPixKey } from "@/lib/crypto";
import { generatePixCopiaECola } from "@/lib/pix";
import { amountCallerOwesRecipient } from "@/lib/group-balances";

/**
 * Every response is private and never cached — the body may carry a decrypted
 * Pix key embedded in the BR Code.
 */
function jsonResponse(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

// One byte-identical denial for every pre-edge refusal. Returning distinct
// messages would let a caller probe whether a co-member has a key configured,
// owes them, etc. By the time a caller has proven a real payable edge (or is
// requesting their own key), key-specific outcomes are safe to surface.
const DENIED = { error: "Acesso negado" } as const;

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonResponse({ error: "Nao autenticado" }, 401);
  }

  const body = await request.json();
  const { recipientUserId, amountCents, groupId } = body as {
    recipientUserId: string;
    amountCents: number;
    groupId?: string;
  };

  if (
    !recipientUserId ||
    !amountCents ||
    amountCents <= 0 ||
    !Number.isInteger(amountCents) ||
    amountCents > 100_000_00 ||
    !groupId
  ) {
    return jsonResponse({ error: "Dados invalidos" }, 400);
  }

  // Authorization first. The encrypted key is never read before this resolves.
  const [{ data: memberRows }, { data: groupRow }] = await Promise.all([
    supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("status", "accepted")
      .in("user_id", [user.id, recipientUserId]),
    supabase.from("groups").select("creator_id").eq("id", groupId).single(),
  ]);

  const callerIsCreator = groupRow?.creator_id === user.id;
  const recipientIsCreator = groupRow?.creator_id === recipientUserId;
  const callerIsAcceptedMember =
    callerIsCreator || memberRows?.some((m) => m.user_id === user.id);
  const recipientIsAcceptedMember =
    recipientIsCreator || memberRows?.some((m) => m.user_id === recipientUserId);

  if (!callerIsAcceptedMember || !recipientIsAcceptedMember) {
    return jsonResponse(DENIED, 403);
  }

  const isSelf = recipientUserId === user.id;

  // A third party's key is disclosed only across a real payable edge: the
  // recipient must be the net creditor of the caller, and the requested amount
  // must not exceed what the caller actually owes. Requesting your own key
  // discloses no third-party secret, so self-collection skips this gate.
  if (!isSelf) {
    const [userA, userB] =
      user.id < recipientUserId ? [user.id, recipientUserId] : [recipientUserId, user.id];
    const { data: balanceRow } = await supabase
      .from("balances")
      .select("group_id, user_a, user_b, amount_cents")
      .eq("group_id", groupId)
      .eq("user_a", userA)
      .eq("user_b", userB)
      .maybeSingle();

    const callerOwes = amountCallerOwesRecipient(
      balanceRow
        ? {
            userA: balanceRow.user_a,
            userB: balanceRow.user_b,
            amountCents: balanceRow.amount_cents,
          }
        : null,
      user.id,
      recipientUserId,
    );

    if (callerOwes <= 0 || amountCents > callerOwes) {
      return jsonResponse(DENIED, 403);
    }
  }

  // Only now — after every gate has passed — read and decrypt the key.
  const admin = createAdminClient();
  const { data: recipient } = await admin
    .from("users")
    .select("pix_key_encrypted, name")
    .eq("id", recipientUserId)
    .single();

  if (!recipient?.pix_key_encrypted) {
    return jsonResponse(
      {
        error: isSelf
          ? "Voce nao tem chave Pix configurada"
          : "Destinatario sem chave Pix configurada",
      },
      404,
    );
  }

  let pixKey: string;
  try {
    pixKey = decryptPixKey(recipient.pix_key_encrypted);
  } catch {
    return jsonResponse({ error: "Erro ao processar chave Pix do destinatario" }, 500);
  }

  const copiaECola = generatePixCopiaECola({
    pixKey,
    merchantName: recipient.name,
    merchantCity: "SAO PAULO",
    amountCents,
  });

  return jsonResponse({ copiaECola }, 200);
}
