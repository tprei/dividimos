"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "./use-auth";

export interface BillInvite {
  billId: string;
  billTitle: string;
  totalAmount: number;
  invitedByName: string;
  createdAt: string;
}

async function loadInvites(userId: string): Promise<BillInvite[]> {
  const supabase = createClient();

  const { data: pending } = await supabase
    .from("bill_participants")
    .select("bill_id, invited_by, joined_at")
    .eq("user_id", userId)
    .eq("status", "invited");

  if (!pending || pending.length === 0) {
    return [];
  }

  const billIds = pending.map((p) => p.bill_id);
  const inviterIds = [...new Set(pending.map((p) => p.invited_by).filter((id): id is string => Boolean(id)))];

  const [billsResult, invitersResult] = await Promise.all([
    supabase.from("bills").select("id, title, total_amount").in("id", billIds),
    inviterIds.length > 0
      ? supabase.from("user_profiles").select("id, name").in("id", inviterIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const bills = billsResult.data;
  const inviters = invitersResult.data;

  const billMap = new Map((bills ?? []).map((b) => [b.id, b]));
  const inviterMap = new Map((inviters ?? []).map((i) => [(i as { id: string; name: string }).id, (i as { id: string; name: string }).name]));

  return pending.map((p) => {
    const bill = billMap.get(p.bill_id);
    return {
      billId: p.bill_id,
      billTitle: bill?.title ?? "",
      totalAmount: bill?.total_amount ?? 0,
      invitedByName: (p.invited_by ? inviterMap.get(p.invited_by) : undefined) ?? "",
      createdAt: p.joined_at,
    };
  });
}

export function useBillInvites() {
  const { user } = useAuth();
  const [invites, setInvites] = useState<BillInvite[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInvites = useCallback(async () => {
    if (!user) return;
    const result = await loadInvites(user.id);
    setInvites(result);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const fetchInvitesRef = useRef(fetchInvites);
  useEffect(() => { fetchInvitesRef.current = fetchInvites; });

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const channel = supabase
      .channel("bill-invites")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bill_participants", filter: `user_id=eq.${user.id}` },
        () => { fetchInvitesRef.current(); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const accept = useCallback(async (billId: string) => {
    if (!user) return;
    await createClient()
      .from("bill_participants")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("bill_id", billId)
      .eq("user_id", user.id);
    await fetchInvites();
  }, [user, fetchInvites]);

  const decline = useCallback(async (billId: string) => {
    if (!user) return;
    await createClient()
      .from("bill_participants")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("bill_id", billId)
      .eq("user_id", user.id);
    await fetchInvites();
  }, [user, fetchInvites]);

  return { invites, loading, accept, decline };
}
