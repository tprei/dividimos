import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import type { Bill, BillItem, BillSplit, ItemSplit, LedgerEntry, User } from "@/types";
import { createLogger, logError } from "@/lib/logger";

const logger = createLogger("sync-bill");

type BillUpdate = Database["public"]["Tables"]["bills"]["Update"];

type BillInsert = Database["public"]["Tables"]["bills"]["Insert"];
type BillParticipantInsert = Database["public"]["Tables"]["bill_participants"]["Insert"];

type BillItemInsert = Database["public"]["Tables"]["bill_items"]["Insert"];
type BillSplitInsert = Database["public"]["Tables"]["bill_splits"]["Insert"];
type ItemSplitInsert = Database["public"]["Tables"]["item_splits"]["Insert"];
type LedgerInsert = Database["public"]["Tables"]["ledger"]["Insert"];

type SupabaseClient = ReturnType<typeof createClient>;

interface BillData {
  bill: Bill;
  participants: User[];
  items: BillItem[];
  splits: ItemSplit[];
  billSplits: BillSplit[];
  ledger: LedgerEntry[];
  existingBillId?: string;
  groupId?: string;
}

export async function syncBillToSupabase(data: BillData): Promise<{ billId: string } | { error: string }> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logError(logger, "User not authenticated", { operation: "syncBillToSupabase" });
    return { error: "Nao autenticado" };
  }

  let billId: string;

  if (data.existingBillId) {
    billId = data.existingBillId;

    // Group bills skip acceptance check — all participants are auto-accepted
    if (!data.groupId) {
      const { data: pending } = await supabase
        .from("bill_participants")
        .select("user_id, status")
        .eq("bill_id", billId)
        .neq("user_id", user.id)
        .neq("status", "accepted");

      if (pending && pending.length > 0) {
        return { error: "Nem todos os participantes aceitaram o convite" };
      }
    }

    // Insert all child data BEFORE updating bill status.
    // The status update triggers a realtime event — if child rows
    // aren't in place yet, the invitee's page reloads with empty data.
    await insertChildData(supabase, billId, data, { cleanExisting: true });

    const syncUpdatePayload: BillUpdate = {
      status: data.bill.status === "settled" ? "settled" : "active",
      total_amount: data.bill.totalAmount,
      total_amount_input: data.bill.totalAmountInput,
      service_fee_percent: data.bill.serviceFeePercent,
      fixed_fees: data.bill.fixedFees,
      group_id: data.groupId,
    };

    const { error: updateError } = await supabase
      .from("bills")
      .update(syncUpdatePayload)
      .eq("id", billId);

    if (updateError) {
      logError(logger, "Failed to update bill", { billId, error: updateError, operation: "updateBill" });
      return { error: updateError.message };
    }

    return { billId };
  } else {
    const insertPayload: BillInsert = {
      creator_id: user.id,
      title: data.bill.title,
      merchant_name: data.bill.merchantName || null,
      status: data.bill.status === "settled" ? "settled" : "active",
      service_fee_percent: data.bill.serviceFeePercent,
      fixed_fees: data.bill.fixedFees,
      total_amount: data.bill.totalAmount,
      bill_type: data.bill.billType,
      total_amount_input: data.bill.totalAmountInput,
      group_id: data.groupId,
    };

    const { data: inserted, error: billError } = await supabase
      .from("bills")
      .insert(insertPayload)
      .select("id")
      .single();

    if (billError || !inserted) {
      logError(logger, "Failed to insert bill", { error: billError, operation: "insertBill" });
      return { error: billError?.message ?? "Erro ao salvar conta" };
    }
    billId = inserted.id;

    const participantRows: BillParticipantInsert[] = data.participants.map((p) => ({
      bill_id: billId,
      user_id: p.id,
      status: "accepted" as const,
    }));
    if (participantRows.length > 0) {
      const { error } = await supabase.from("bill_participants").insert(participantRows);
      if (error) logError(logger, "Failed to insert participants", { billId, error, operation: "insertParticipants" });
    }
  }

  await insertChildData(supabase, billId, data);

  return { billId };
}

async function insertChildData(
  supabase: SupabaseClient,
  billId: string,
  data: BillData,
  { cleanExisting = false }: { cleanExisting?: boolean } = {},
) {
  // Clean up any existing draft child data before inserting final data
  if (cleanExisting) {
    const cleanupResults = await Promise.allSettled([
      supabase.from("bill_items").delete().eq("bill_id", billId),
      supabase.from("bill_splits").delete().eq("bill_id", billId),
      supabase.from("bill_payers").delete().eq("bill_id", billId),
      supabase.from("ledger").delete().eq("bill_id", billId),
    ]);
    for (const result of cleanupResults) {
      if (result.status === "rejected") {
        logError(logger, "Failed to clean up draft child data (rejected)", {
          billId,
          reason: result.reason,
          operation: "cleanupChildData",
        });
      } else if (result.value.error) {
        logError(logger, "Failed to clean up draft child data", {
          billId,
          error: result.value.error,
          operation: "cleanupChildData",
        });
      }
    }
  }

  if (data.bill.billType === "itemized" && data.items.length > 0) {
    const localIdToUuid = new Map<string, string>();
    for (const item of data.items) {
      localIdToUuid.set(item.id, crypto.randomUUID());
    }

    const itemRows: BillItemInsert[] = data.items.map((item) => ({
      id: localIdToUuid.get(item.id),
      bill_id: billId,
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unitPriceCents,
      total_price_cents: item.totalPriceCents,
    }));

    const { error: itemsError } = await supabase.from("bill_items").insert(itemRows);
    if (itemsError) {
      logError(logger, "Failed to insert items", { billId, error: itemsError, operation: "insertItems" });
    }

    const itemSplitRows: ItemSplitInsert[] = (data.splits ?? []).flatMap((s) => {
      const itemUuid = localIdToUuid.get(s.itemId);
      if (!itemUuid) return [];
      return [{
        item_id: itemUuid,
        user_id: s.userId,
        split_type: s.splitType,
        value: s.value,
        computed_amount_cents: s.computedAmountCents,
      }];
    });

    const payerRows = data.bill.payers.map((p) => ({
      bill_id: billId,
      user_id: p.userId,
      amount_cents: p.amountCents,
    }));

    const ledgerRows: LedgerInsert[] = data.ledger.map((e) => ({
      bill_id: billId,
      from_user_id: e.fromUserId,
      to_user_id: e.toUserId,
      amount_cents: e.amountCents,
      status: e.status,
    }));

    await Promise.all([
      itemSplitRows.length > 0
        ? supabase.from("item_splits").insert(itemSplitRows).then(({ error }) => {
            if (error) logError(logger, "Failed to insert item splits", { billId, error, operation: "insertItemSplits" });
          })
        : Promise.resolve(),
      payerRows.length > 0
        ? supabase.from("bill_payers").insert(payerRows).then(({ error }) => {
            if (error) logError(logger, "Failed to insert payers", { billId, error, operation: "insertPayers" });
          })
        : Promise.resolve(),
      ledgerRows.length > 0
        ? supabase.from("ledger").insert(ledgerRows).then(({ error }) => {
            if (error) logError(logger, "Failed to insert ledger", { billId, error, operation: "insertLedger" });
          })
        : Promise.resolve(),
    ]);

    return;
  }

  if (data.bill.billType === "single_amount" && data.billSplits.length > 0) {
    const splitRows: BillSplitInsert[] = data.billSplits.map((s) => ({
      bill_id: billId,
      user_id: s.userId,
      split_type: s.splitType,
      value: s.value,
      computed_amount_cents: s.computedAmountCents,
    }));

    const payerRows = data.bill.payers.map((p) => ({
      bill_id: billId,
      user_id: p.userId,
      amount_cents: p.amountCents,
    }));

    const ledgerRows: LedgerInsert[] = data.ledger.map((e) => ({
      bill_id: billId,
      from_user_id: e.fromUserId,
      to_user_id: e.toUserId,
      amount_cents: e.amountCents,
      status: e.status,
    }));

    await Promise.all([
      supabase.from("bill_splits").insert(splitRows).then(({ error }) => {
        if (error) logError(logger, "Failed to insert bill splits", { billId, error, operation: "insertBillSplits" });
      }),
      payerRows.length > 0
        ? supabase.from("bill_payers").insert(payerRows).then(({ error }) => {
            if (error) logError(logger, "Failed to insert payers", { billId, error, operation: "insertPayers" });
          })
        : Promise.resolve(),
      ledgerRows.length > 0
        ? supabase.from("ledger").insert(ledgerRows).then(({ error }) => {
            if (error) logError(logger, "Failed to insert ledger", { billId, error, operation: "insertLedger" });
          })
        : Promise.resolve(),
    ]);

    return;
  }

  const payerRows = data.bill.payers.map((p) => ({
    bill_id: billId,
    user_id: p.userId,
    amount_cents: p.amountCents,
  }));

  const ledgerRows: LedgerInsert[] = data.ledger.map((e) => ({
    bill_id: billId,
    from_user_id: e.fromUserId,
    to_user_id: e.toUserId,
    amount_cents: e.amountCents,
    status: e.status,
  }));

  await Promise.all([
    payerRows.length > 0
      ? supabase.from("bill_payers").insert(payerRows).then(({ error }) => {
          if (error) logError(logger, "Failed to insert payers", { billId, error, operation: "insertPayers" });
        })
      : Promise.resolve(),
    ledgerRows.length > 0
      ? supabase.from("ledger").insert(ledgerRows).then(({ error }) => {
          if (error) logError(logger, "Failed to insert ledger", { billId, error, operation: "insertLedger" });
        })
      : Promise.resolve(),
  ]);
}
