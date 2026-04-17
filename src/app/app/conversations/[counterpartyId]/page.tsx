import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  expenseRowToExpense,
  settlementRowToSettlement,
  userProfileRowToUserProfile,
} from "@/lib/supabase/expense-mappers";
import { ConversationPageClient } from "./conversation-page-client";
import type { ConversationInitialData } from "./conversation-page-client";
import type { ChatMessageWithSender, Expense, Settlement, UserProfile } from "@/types";
import type { Database } from "@/types/database";

type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];

const PAGE_SIZE = 50;

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ counterpartyId: string }>;
}) {
  const { counterpartyId } = await params;
  const user = await getAuthUser();

  if (!user) return null;

  const supabase = await createClient();

  // Get or create DM group (must exist before profile fetch due to RLS)
  const { data: groupId, error: rpcError } = await supabase.rpc(
    "get_or_create_dm_group",
    { p_other_user_id: counterpartyId },
  );

  if (rpcError || !groupId) {
    return (
      <ConversationPageClient
        initialData={{
          counterpartyId,
          currentUser: {
            id: user.id,
            handle: user.handle,
            name: user.name,
            avatarUrl: user.avatarUrl,
          },
          error: rpcError?.message ?? "Erro ao criar conversa",
          groupId: null,
          counterparty: null,
          thread: null,
          hasMore: false,
          callerStatus: "accepted",
          counterpartyStatus: "accepted",
        }}
      />
    );
  }

  // Parallel: profile, messages, member statuses
  const [profileResult, messagesQuery, membersResult] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("*")
      .eq("id", counterpartyId)
      .single(),
    supabase
      .from("chat_messages")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE),
    supabase
      .from("group_members")
      .select("user_id, status")
      .eq("group_id", groupId)
      .in("user_id", [user.id, counterpartyId]),
  ]);

  if (profileResult.error || !profileResult.data) {
    return (
      <ConversationPageClient
        initialData={{
          counterpartyId,
          currentUser: {
            id: user.id,
            handle: user.handle,
            name: user.name,
            avatarUrl: user.avatarUrl,
          },
          error: "Usuário não encontrado",
          groupId: groupId as string,
          counterparty: null,
          thread: null,
          hasMore: false,
          callerStatus: "accepted",
          counterpartyStatus: "accepted",
        }}
      />
    );
  }

  const counterparty = userProfileRowToUserProfile(profileResult.data);

  // Parse member statuses
  const memberRows = (membersResult.data ?? []) as { user_id: string; status: string }[];
  const callerRow = memberRows.find((m) => m.user_id === user.id);
  const counterpartyRow = memberRows.find((m) => m.user_id === counterpartyId);
  const callerStatus = (callerRow?.status ?? "accepted") as "accepted" | "invited" | "declined";
  const counterpartyStatus = (counterpartyRow?.status ?? "invited") as "accepted" | "invited" | "declined";

  // Process messages
  const messageRows = (messagesQuery.data ?? []).reverse() as ChatMessageRow[];
  const hasMore = (messagesQuery.data ?? []).length >= PAGE_SIZE;

  if (messageRows.length === 0) {
    // Fire-and-forget read receipt
    supabase.from("conversation_read_receipts").upsert(
      { user_id: user.id, group_id: groupId as string, last_read_at: new Date().toISOString() },
      { onConflict: "user_id,group_id" },
    ).then(() => {});

    return (
      <ConversationPageClient
        initialData={{
          counterpartyId,
          currentUser: {
            id: user.id,
            handle: user.handle,
            name: user.name,
            avatarUrl: user.avatarUrl,
          },
          groupId: groupId as string,
          counterparty,
          thread: {
            messages: [],
            expenses: [],
            settlements: [],
            profiles: [[counterparty.id, counterparty]],
          },
          hasMore: false,
          callerStatus,
          counterpartyStatus,
          error: null,
        }}
      />
    );
  }

  // Collect IDs for batch fetching
  const senderIds = new Set<string>();
  const expenseIds = new Set<string>();
  const settlementIds = new Set<string>();

  for (const row of messageRows) {
    senderIds.add(row.sender_id);
    if (row.expense_id) expenseIds.add(row.expense_id);
    if (row.settlement_id) settlementIds.add(row.settlement_id);
  }

  // Parallel batch fetches for related entities
  const [profilesResult, expensesResult, settlementsResult] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("*")
      .in("id", [...senderIds]),
    expenseIds.size > 0
      ? supabase.from("expenses").select("*").in("id", [...expenseIds])
      : Promise.resolve({ data: [] as Database["public"]["Tables"]["expenses"]["Row"][], error: null }),
    settlementIds.size > 0
      ? supabase.from("settlements").select("*").in("id", [...settlementIds])
      : Promise.resolve({ data: [] as Database["public"]["Tables"]["settlements"]["Row"][], error: null }),
  ]);

  // Build profile map
  const profileMap = new Map<string, UserProfile>();
  profileMap.set(counterparty.id, counterparty);
  for (const row of profilesResult.data ?? []) {
    profileMap.set(row.id, userProfileRowToUserProfile(row));
  }

  // Build expense map
  const expenseEntries: [string, Expense][] = [];
  for (const row of expensesResult.data ?? []) {
    const expense = expenseRowToExpense(row as Database["public"]["Tables"]["expenses"]["Row"]);
    expenseEntries.push([expense.id, expense]);
  }

  // Build settlement map
  const settlementEntries: [string, Settlement][] = [];
  if (settlementsResult.data && settlementsResult.data.length > 0) {
    // Fetch any settlement user profiles not already loaded
    const settlementUserIds = new Set<string>();
    for (const row of settlementsResult.data) {
      const s = row as Database["public"]["Tables"]["settlements"]["Row"];
      if (!profileMap.has(s.from_user_id)) settlementUserIds.add(s.from_user_id);
      if (!profileMap.has(s.to_user_id)) settlementUserIds.add(s.to_user_id);
    }
    if (settlementUserIds.size > 0) {
      const { data: extraProfiles } = await supabase
        .from("user_profiles")
        .select("*")
        .in("id", [...settlementUserIds]);
      for (const row of extraProfiles ?? []) {
        profileMap.set(row.id, userProfileRowToUserProfile(row));
      }
    }

    for (const row of settlementsResult.data) {
      const settlement = settlementRowToSettlement(
        row as Database["public"]["Tables"]["settlements"]["Row"],
      );
      settlementEntries.push([settlement.id, settlement]);
    }
  }

  // Build messages with sender profiles
  const fallbackProfile: UserProfile = {
    id: "unknown",
    handle: "unknown",
    name: "Usuário",
  };

  const messages: ChatMessageWithSender[] = messageRows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    senderId: row.sender_id,
    messageType: row.message_type,
    content: row.content,
    expenseId: row.expense_id ?? undefined,
    settlementId: row.settlement_id ?? undefined,
    createdAt: row.created_at,
    sender: profileMap.get(row.sender_id) ?? { ...fallbackProfile, id: row.sender_id },
  }));

  // Fire-and-forget read receipt (server-side, non-blocking)
  supabase.from("conversation_read_receipts").upsert(
    { user_id: user.id, group_id: groupId as string, last_read_at: new Date().toISOString() },
    { onConflict: "user_id,group_id" },
  ).then(() => {});

  // Serialize Maps as arrays of tuples for SSR transfer
  const initialData: ConversationInitialData = {
    counterpartyId,
    currentUser: {
      id: user.id,
      handle: user.handle,
      name: user.name,
      avatarUrl: user.avatarUrl,
    },
    groupId: groupId as string,
    counterparty,
    thread: {
      messages,
      expenses: expenseEntries,
      settlements: settlementEntries,
      profiles: [...profileMap.entries()],
    },
    hasMore,
    callerStatus,
    counterpartyStatus,
    error: null,
  };

  return <ConversationPageClient initialData={initialData} />;
}
