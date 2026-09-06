"use server";

import { createClient } from "@/lib/supabase/server";
import { CLAIM_TOKEN_RE } from "@/lib/claim-qr";

export type ClaimPreview =
  | { kind: "not_found" }
  | { kind: "sign_in_required" }
  | { kind: "already_claimed" }
  | {
      kind: "ready";
      guestId: string;
      displayName: string;
      expenseTitle: string;
      groupName: string;
      shareCents: number;
    };

function notFound(): ClaimPreview {
  return { kind: "not_found" };
}

export async function previewGuestClaim(token: string): Promise<ClaimPreview> {
  if (!CLAIM_TOKEN_RE.test(token)) return notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_guest_claim_token", {
    p_token: token,
  });

  if (error || !data || typeof data !== "object") return notFound();

  const raw = data as Record<string, unknown>;
  const status = raw.status as string;

  if (status === "already_claimed") {
    return { kind: "already_claimed" };
  }

  if (status === "ready") {
    return {
      kind: "ready",
      guestId: (raw.guestId as string) ?? "",
      displayName: (raw.displayName as string) ?? "",
      expenseTitle: (raw.expenseTitle as string) ?? "",
      groupName: (raw.groupName as string) ?? "",
      shareCents: typeof raw.shareCents === "number" ? raw.shareCents : 0,
    };
  }

  return notFound();
}
