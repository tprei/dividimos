"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CLAIM_TOKEN_RE } from "@/lib/claim-qr";

// Issue #472 privacy contract. The preview must reveal nothing about a guest
// spot beyond what the caller is authorized to see, and must be
// indistinguishable from "not found" for every unauthorized or unknown path.
// The step order below is load-bearing — do not reorder.

export type ClaimPreview =
  | { kind: "not_found" }
  | { kind: "sign_in_required" }
  | { kind: "already_claimed" }
  | {
      kind: "ready";
      expenseId: string;
      expenseStatus: string;
      guestName: string;
      expenseTitle: string;
      shareAmountCents: number;
      creatorName: string;
    };

function notFound(): ClaimPreview {
  return { kind: "not_found" };
}

export async function previewGuestClaim(token: string): Promise<ClaimPreview> {
  // (1) Format check. A malformed credential is indistinguishable from a miss.
  if (!CLAIM_TOKEN_RE.test(token)) return notFound();

  const admin = createAdminClient();

  // (2) Credential resolve (service-only). Anything other than exactly one row
  //     is "not found" — no further query runs.
  const { data: resolved } = await admin.rpc("resolve_guest_claim_token", {
    p_claim_token: token,
  });
  if (!resolved || resolved.length !== 1) return notFound();
  const { guest_id: guestId, expense_id: expenseId, group_id: groupId } =
    resolved[0];

  // (3) Group shape + DM pair. Fetched before authentication so the DM branch
  //     can short-circuit without a second round-trip.
  const [{ data: group }, { data: dmPair }] = await Promise.all([
    admin.from("groups").select("id, is_dm").eq("id", groupId).maybeSingle(),
    admin
      .from("dm_pairs")
      .select("user_a, user_b")
      .eq("group_id", groupId)
      .maybeSingle(),
  ]);
  if (!group) return notFound();

  // (4) Authenticated user.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (group.is_dm) {
    // (6) DM + unauthenticated → sign in required. No display query, no fields.
    if (!user) return { kind: "sign_in_required" };
    // (7) DM + authenticated non-pair → not found. No display query.
    const inPair =
      !!dmPair && (dmPair.user_a === user.id || dmPair.user_b === user.id);
    if (!inPair) return notFound();
    // (8) DM + authenticated pair → fall through to the ready/claimed read.
  }

  // (5) Ready / already_claimed. Fetch only the display fields.
  const [{ data: guest }, { data: expense }, { data: guestShare }] =
    await Promise.all([
      admin
        .from("expense_guests")
        .select("display_name, claimed_by")
        .eq("id", guestId)
        .maybeSingle(),
      admin
        .from("expenses")
        .select("title, status, creator_id")
        .eq("id", expenseId)
        .maybeSingle(),
      admin
        .from("expense_guest_shares")
        .select("share_amount_cents")
        .eq("guest_id", guestId)
        .maybeSingle(),
    ]);

  if (!guest || !expense) return notFound();
  if (guest.claimed_by) return { kind: "already_claimed" };

  const { data: creator } = await admin
    .from("user_profiles")
    .select("name")
    .eq("id", expense.creator_id)
    .maybeSingle();

  return {
    kind: "ready",
    expenseId,
    expenseStatus: expense.status,
    guestName: guest.display_name,
    expenseTitle: expense.title,
    shareAmountCents: guestShare?.share_amount_cents ?? 0,
    creatorName: creator?.name ?? "Alguém",
  };
}
