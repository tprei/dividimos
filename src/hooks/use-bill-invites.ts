"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "./use-auth";

export interface BillInvite {
  billId: string;
  billTitle: string;
  totalAmount: number;
  invitedByName: string;
  createdAt: string;
}

export function useBillInvites() {
  const { user } = useAuth();
  const [invites, setInvites] = useState<BillInvite[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchInvites() {
    if (!user) return;
    const supabase = createClient();

    const { data: pending } = await supabase
      .from("bill_participants")
      .select("bill_id, invited_by, joined_at")
      .eq("user_id", user.id)
      .eq("status", "invited");

    if (!pending || pending.length === 0) {
      setInvites([]);
      setLoading(false);
      return;
    }

    const billIds = pending.map((p) => p.bill_id);
    const inviterIds = [...new Set(pending.map((p) => p.invited_by).filter(Boolean))];

    const { data: bills } = await supabase
      .from("bills")
      .select("id, title, total_amount")
      .in("id", billIds);

    const { data: inviters } = inviterIds.length > 0
      ? await supabase.from("user_profiles").select("id, name").in("id", inviterIds)
      : { data: [] };

    const billMap = new Map((bills ?? []).map((b) => [b.id, b]));
    const inviterMap = new Map((inviters ?? []).map((i) => [i.id, i.name]));

    const result: BillInvite[] = pending.map((p) => {
      const bill = billMap.get(p.bill_id);
      return {
        billId: p.bill_id,
        billTitle: bill?.title ?? "",
        totalAmount: bill?.total_amount ?? 0,
        invitedByName: inviterMap.get(p.invited_by) ?? "",
        createdAt: p.joined_at,
      };
    });

    setInvites(result);
    setLoading(false);
  }

  useEffect(() => {
    fetchInvites(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const channel = supabase
      .channel("bill-invites")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bill_participants", filter: `user_id=eq.${user.id}` },
        () => { fetchInvites(); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const accept = async (billId: string) => {
    if (!user) return;
    await createClient()
      .from("bill_participants")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("bill_id", billId)
      .eq("user_id", user.id);
    await fetchInvites();
  };

  const decline = async (billId: string) => {
    if (!user) return;
    await createClient()
      .from("bill_participants")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("bill_id", billId)
      .eq("user_id", user.id);
    await fetchInvites();
  };

  return { invites, loading, accept, decline };
}
