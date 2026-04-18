"use server";

import { createClient } from "@/lib/supabase/server";
import type { VendorCharge } from "@/types";

type VendorChargeRow = {
  id: string;
  user_id: string;
  amount_cents: number;
  description: string | null;
  status: "pending" | "received";
  created_at: string;
  confirmed_at: string | null;
};

function mapRow(row: VendorChargeRow): VendorCharge {
  return {
    id: row.id,
    userId: row.user_id,
    amountCents: row.amount_cents,
    description: row.description ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
  };
}

export async function recordVendorCharge(
  amountCents: number,
  description?: string,
): Promise<VendorCharge> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { data, error } = await supabase
    .from("vendor_charges")
    .insert({
      user_id: user.id,
      amount_cents: amountCents,
      description: description || null,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw new Error(`Falha ao criar cobrança: ${error.message}`);

  return mapRow(data as VendorChargeRow);
}

export async function confirmVendorCharge(chargeId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("vendor_charges")
    .update({
      status: "received",
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", chargeId)
    .eq("status", "pending");

  if (error) throw new Error(`Falha ao confirmar cobrança: ${error.message}`);
}

export async function listVendorCharges(
  limit = 50,
): Promise<VendorCharge[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { data, error } = await supabase
    .from("vendor_charges")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Falha ao listar cobranças: ${error.message}`);

  return (data as VendorChargeRow[] ?? []).map(mapRow);
}
