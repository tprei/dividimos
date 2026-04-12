import { ConversationsListContent } from "@/components/conversations/conversations-list-content";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types";

export interface ConversationEntry {
  groupId: string;
  counterparty: UserProfile;
  lastMessageContent: string | null;
  lastMessageAt: string | null;
  netBalanceCents: number;
}

export default async function ConversationsPage() {
  const user = await getAuthUser();

  if (!user) return null;

  const supabase = await createClient();

  const { data: dmPairs } = await supabase
    .from("dm_pairs")
    .select("group_id, user_a, user_b")
    .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);

  if (!dmPairs || dmPairs.length === 0) {
    return <ConversationsListContent initialConversations={[]} />;
  }

  const counterpartyIds = dmPairs.map((p) =>
    p.user_a === user.id ? p.user_b : p.user_a,
  );
  const groupIds = dmPairs.map((p) => p.group_id);

  const [{ data: profiles }, { data: lastMessages }, { data: balanceRows }] =
    await Promise.all([
      supabase
        .from("user_profiles")
        .select("id, handle, name, avatar_url")
        .in("id", counterpartyIds),
      supabase
        .from("chat_messages")
        .select("group_id, content, message_type, created_at")
        .in("group_id", groupIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("balances")
        .select("group_id, user_a, user_b, amount_cents")
        .in("group_id", groupIds)
        .neq("amount_cents", 0),
    ]);

  const profileMap = new Map(
    (profiles ?? []).map((p) => [
      p.id,
      {
        id: p.id,
        handle: p.handle,
        name: p.name,
        avatarUrl: p.avatar_url ?? undefined,
      } as UserProfile,
    ]),
  );

  const lastMessageByGroup = new Map<
    string,
    { content: string; messageType: string; createdAt: string }
  >();
  for (const msg of lastMessages ?? []) {
    if (!lastMessageByGroup.has(msg.group_id)) {
      lastMessageByGroup.set(msg.group_id, {
        content: msg.content,
        messageType: msg.message_type,
        createdAt: msg.created_at,
      });
    }
  }

  const balanceByGroup = new Map<string, number>();
  for (const b of (balanceRows as {
    group_id: string;
    user_a: string;
    user_b: string;
    amount_cents: number;
  }[]) ?? []) {
    const net =
      b.user_a === user.id ? -b.amount_cents : b.amount_cents;
    balanceByGroup.set(
      b.group_id,
      (balanceByGroup.get(b.group_id) ?? 0) + net,
    );
  }

  const conversations: ConversationEntry[] = dmPairs
    .map((pair) => {
      const counterpartyId =
        pair.user_a === user.id ? pair.user_b : pair.user_a;
      const counterparty = profileMap.get(counterpartyId);
      if (!counterparty) return null;

      const lastMsg = lastMessageByGroup.get(pair.group_id);
      const lastMessageContent = lastMsg
        ? lastMsg.messageType === "text"
          ? lastMsg.content
          : lastMsg.messageType === "system_expense"
            ? "Nova conta criada"
            : "Pagamento registrado"
        : null;

      return {
        groupId: pair.group_id,
        counterparty,
        lastMessageContent,
        lastMessageAt: lastMsg?.createdAt ?? null,
        netBalanceCents: balanceByGroup.get(pair.group_id) ?? 0,
      };
    })
    .filter((c): c is ConversationEntry => c !== null)
    .sort((a, b) => {
      const aTime = a.lastMessageAt ?? "";
      const bTime = b.lastMessageAt ?? "";
      return bTime.localeCompare(aTime);
    });

  return <ConversationsListContent initialConversations={conversations} />;
}
