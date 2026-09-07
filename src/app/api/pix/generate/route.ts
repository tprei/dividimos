import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import { decryptPixKey } from "@/lib/crypto";
import { generatePixCopiaECola } from "@/lib/pix";
import { transfersFromBalances } from "@/lib/ledger/transfers";
import type { BalanceRow, ParticipantKind } from "@/types/ledger";
import { jsonResponse } from "../response";

// One byte-identical denial for every pre-edge refusal. Returning distinct
// messages would let a caller probe whether a co-member has a key configured,
// owes them, etc. By the time a caller has proven a real payable edge (or is
const DENIED = { error: "Acesso negado" } as const;

interface GroupBalanceDbRow {
  kind: ParticipantKind;
  participant_id: string;
  net_cents: number | string;
}

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
    return jsonResponse({ error: "Dados inválidos" }, 400);
  }

  try {
    await enforceRateLimit("pix.generate", callerId);
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMIT_EXCEEDED") {
      return jsonResponse(
        { error: "Muitas requisições. Tente novamente em alguns segundos." },
        429,
      );
    }
    if (!(error instanceof AppError && error.code === "RATE_LIMIT_UNAVAILABLE")) {
      console.error("[pix/generate] unexpected rate-limit failure:", error);
    }
    return jsonResponse({ error: "Serviço temporariamente indisponível" }, 503);
  }

  // Authorization first. The encrypted key is never read before this resolves.
  const admin = createAdminClient();
  const { data: memberRows } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("status", "accepted")
    .in("user_id", [callerId, recipientUserId]);

  const callerIsAccepted = memberRows?.some((m) => m.user_id === callerId);
  const recipientIsAccepted = memberRows?.some((m) => m.user_id === recipientUserId);

  if (!callerIsAccepted || !recipientIsAccepted) {
    return jsonResponse(DENIED, 403);
  }

  const isSelf = recipientUserId === callerId;

  // A third party's key is disclosed only across a real payable edge: the
  // recipient must be the net creditor of the caller, and the requested amount
  // must not exceed what the caller actually owes. Requesting your own key
  // discloses no third-party secret, so self-collection skips this gate.
  if (!isSelf) {
    // Generated Database types do not yet reflect the Phase 4 group_balances table.
    const untypedAdmin = admin as unknown as SupabaseClient;
    const { data: balanceRows } = await untypedAdmin
      .from("group_balances")
      .select("kind, participant_id, net_cents")
      .eq("group_id", groupId);

    const rawRows = (balanceRows ?? []) as unknown as GroupBalanceDbRow[];
    const balances: BalanceRow[] = rawRows.map((row) => ({
      kind: row.kind,
      participantId: row.participant_id,
      netCents: Number(row.net_cents),
    }));

    const transfers = transfersFromBalances(balances);
    const transfer = transfers.find(
      (t) => t.fromId === callerId && t.toId === recipientUserId,
    );

    if (!transfer || amountCents > transfer.amountCents) {
      return jsonResponse(DENIED, 403);
    }
  }

  // Only now — after every gate has passed — read and decrypt the key.
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
    return jsonResponse(
      {
        error: isSelf
          ? "Erro ao processar sua chave Pix"
          : "Erro ao processar chave Pix do destinatário",
      },
      500,
    );
  }

  const copiaECola = generatePixCopiaECola({
    pixKey,
    merchantName: recipient.name,
    merchantCity: "SAO PAULO",
    amountCents,
  });

  return jsonResponse({ copiaECola }, 200);
}
