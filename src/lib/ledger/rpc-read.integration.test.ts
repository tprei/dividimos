import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  createTestUsers,
  authenticateAs,
  createGroup,
  acceptInvitation,
  createGroupWithMembers,
  createExpense,
  equalSplitPayload,
  expectRpcError,
  type TestUser,
} from "@/test/integration-helpers";

// Minimal wire types (contract: local://p1-contract.md "Wire shapes").
interface UserProfile {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
}

interface MeProfile extends UserProfile {
  email: string;
  pixKeyType: string | null;
  pixKeyHint: string | null;
  onboarded: boolean;
  notificationPreferences: Record<string, unknown> | null;
}

interface GroupInfo {
  id: string;
  kind: string;
  name: string;
  creatorId: string;
  dmUserA: string | null;
  dmUserB: string | null;
  ledgerVersion: number;
  createdAt: string;
}

interface GroupSnapshot {
  group: GroupInfo;
  members: Array<{
    groupId: string;
    userId: string;
    status: string;
    invitedBy: string | null;
    acceptedAt: string | null;
    user: UserProfile;
  }>;
  balances: Array<{ kind: string; participantId: string; netCents: number }>;
  guests: Array<{ id: string; displayName: string; expenseId: string }>;
  settlements: unknown[];
  recentExpenses: ExpenseSummary[];
  lastEventId: number;
  unreadCount: number;
  lastMessage: { content: string; senderId: string; createdAt: string } | null;
  lastActivityAt: string;
}

interface ExpenseSummary {
  id: string;
  groupId: string;
  creatorId: string;
  status: string;
  occurredOn: string;
  createdAt: string;
  versionNo: number;
  title: string;
  merchantName: string | null;
  expenseType: string;
  totalCents: number;
  myShareCents: number;
  myPaidCents: number;
  participantCount: number;
}

interface ExpenseVersion {
  expenseId: string;
  versionNo: number;
  authorId: string;
  createdAt: string;
  occurredOn: string;
  title: string;
  merchantName: string | null;
  expenseType: string;
  totalCents: number;
  serviceFeeBasisPoints: number;
  fixedFeeCents: number;
  payload: unknown;
  changeSummary: unknown;
}

interface ExpenseDetail {
  expense: {
    id: string;
    groupId: string;
    creatorId: string;
    status: string;
    currentVersionNo: number;
    occurredOn: string;
    createdAt: string;
    deletedAt: string | null;
    deletedBy: string | null;
  };
  current: ExpenseVersion;
  versions: ExpenseVersion[];
  participants: Array<{
    participantIndex: number;
    kind: string;
    shareCents: number;
    paidCents: number;
    user: UserProfile | null;
    guest: unknown;
  }>;
  group: { id: string; name: string; kind: string };
}

interface ChatMessage {
  id: string;
  clientId: string;
  groupId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender: UserProfile;
}

interface GroupEvent {
  id: number;
  groupId: string;
  actorId: string | null;
  kind: string;
  expenseId: string | null;
  settlementId: string | null;
  subjectUserId: string | null;
  payload: unknown;
  createdAt: string;
  actor: UserProfile | null;
  expenseTitle: string | null;
}

interface Conversation {
  messages: ChatMessage[];
  events: GroupEvent[];
}

interface BootstrapPayload {
  me: MeProfile;
  groups: GroupSnapshot[];
  serverTime: string;
}

type RpcResult<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
};

async function rpc<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult<T>> {
  return (await client.rpc(fn, args)) as RpcResult<T>;
}

async function rpcOk<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await rpc<T>(client, fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  if (data === null || data === undefined) {
    throw new Error(`${fn} returned no data`);
  }
  return data;
}

const ME_KEYS = [
  "id",
  "handle",
  "name",
  "avatarUrl",
  "email",
  "pixKeyType",
  "pixKeyHint",
  "onboarded",
  "notificationPreferences",
];

const SNAPSHOT_KEYS = [
  "group",
  "members",
  "balances",
  "guests",
  "settlements",
  "recentExpenses",
  "lastEventId",
  "unreadCount",
  "lastMessage",
  "lastActivityAt",
];

const EXPENSE_SUMMARY_KEYS = [
  "id",
  "groupId",
  "creatorId",
  "status",
  "occurredOn",
  "createdAt",
  "versionNo",
  "title",
  "merchantName",
  "expenseType",
  "totalCents",
  "myShareCents",
  "myPaidCents",
  "participantCount",
];

const EXPENSE_DETAIL_KEYS = ["expense", "current", "versions", "participants", "group"];

const CHAT_MESSAGE_KEYS = [
  "id",
  "clientId",
  "groupId",
  "senderId",
  "content",
  "createdAt",
  "sender",
];

const PUBLIC_TABLES = [
  "users",
  "groups",
  "group_members",
  "group_invite_links",
  "expenses",
  "expense_versions",
  "guests",
  "expense_participants",
  "settlements",
  "group_balances",
  "group_events",
  "chat_messages",
  "conversation_reads",
  "push_subscriptions",
  "rate_limit_counters",
  "vendor_charges",
] as const;

describe.skipIf(!isIntegrationTestReady)("ledger read RPCs — integration", () => {
  let userA!: TestUser;
  let userB!: TestUser;
  let userX!: TestUser;
  let g1!: string;
  let g2!: string;
  let expenseId!: string;
  let msgA!: ChatMessage;
  let msgB!: ChatMessage;

  const EXPENSE_TITLE = "Jantar de sexta";
  const EXPENSE_DATE = "2026-09-01";
  const MSG_A = "primeira mensagem do A";
  const MSG_B = "primeira mensagem do B";

  beforeAll(async () => {
    [userA, userB, userX] = await createTestUsers(3);

    g1 = await createGroupWithMembers(userA, [userB], "Leitura G1");
    const created = await createExpense(userA, {
      groupId: g1,
      title: EXPENSE_TITLE,
      occurredOn: EXPENSE_DATE,
      totalCents: 1000,
      payload: equalSplitPayload([userA.id, userB.id], 1000),
    });
    expenseId = created.expenseId;

    msgA = await rpcOk<ChatMessage>(authenticateAs(userA), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: g1,
      p_content: MSG_A,
    });
    msgB = await rpcOk<ChatMessage>(authenticateAs(userB), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: g1,
      p_content: MSG_B,
    });

    // G2 ends up A-only, but carries one event (member_invited from creation)
    // so get_activity can be checked across both of A's groups.
    const g2Ack = await rpcOk<{ groupId: string }>(
      authenticateAs(userA),
      "create_group",
      { p_name: "Leitura G2", p_member_ids: [userB.id] },
    );
    g2 = g2Ack.groupId;
    await rpcOk<unknown>(authenticateAs(userB), "decline_invitation", {
      p_group_id: g2,
    });
  });

  it("bootstraps A with exactly G1 and G2 and the exact Me shape", async () => {
    const boot = await rpcOk<BootstrapPayload>(authenticateAs(userA), "bootstrap", {});
    expect(Object.keys(boot.me).sort()).toEqual([...ME_KEYS].sort());
    expect("pixKeyEncrypted" in boot.me).toBe(false);
    expect(boot.me.id).toBe(userA.id);
    expect(boot.groups.map((g) => g.group.id).sort()).toEqual([g1, g2].sort());
    expect(typeof boot.serverTime).toBe("string");
  });

  it("bootstraps B with only G1", async () => {
    const boot = await rpcOk<BootstrapPayload>(authenticateAs(userB), "bootstrap", {});
    expect(boot.groups.map((g) => g.group.id)).toEqual([g1]);
  });

  it("bootstraps an outsider with no groups", async () => {
    const boot = await rpcOk<BootstrapPayload>(authenticateAs(userX), "bootstrap", {});
    expect(boot.me.id).toBe(userX.id);
    expect(boot.groups).toEqual([]);
  });

  it("get_group exposes exactly the snapshot keys with members and balances", async () => {
    const snap = await rpcOk<GroupSnapshot>(authenticateAs(userA), "get_group", {
      p_group_id: g1,
    });
    expect(Object.keys(snap).sort()).toEqual([...SNAPSHOT_KEYS].sort());
    expect(snap.group.id).toBe(g1);
    expect(snap.members.map((m) => m.userId).sort()).toEqual(
      [userA.id, userB.id].sort(),
    );
    // A paid the whole 1000 and owes half; B owes half.
    const balanceA = snap.balances.find(
      (b) => b.kind === "user" && b.participantId === userA.id,
    );
    const balanceB = snap.balances.find(
      (b) => b.kind === "user" && b.participantId === userB.id,
    );
    expect(balanceA?.netCents).toBe(500);
    expect(balanceB?.netCents).toBe(-500);
  });

  it("recentExpenses carries exact ExpenseSummary keys and per-viewer shares", async () => {
    const snapA = await rpcOk<GroupSnapshot>(authenticateAs(userA), "get_group", {
      p_group_id: g1,
    });
    expect(snapA.recentExpenses).toHaveLength(1);
    const forA = snapA.recentExpenses[0];
    if (!forA) throw new Error("expected one recent expense for A");
    expect(Object.keys(forA).sort()).toEqual([...EXPENSE_SUMMARY_KEYS].sort());
    expect(forA.id).toBe(expenseId);
    expect(forA.totalCents).toBe(1000);
    expect(forA.occurredOn).toBe(EXPENSE_DATE);
    expect(forA.participantCount).toBe(2);
    expect(forA.myShareCents).toBe(500);
    expect(forA.myPaidCents).toBe(1000);

    const snapB = await rpcOk<GroupSnapshot>(authenticateAs(userB), "get_group", {
      p_group_id: g1,
    });
    const forB = snapB.recentExpenses[0];
    if (!forB) throw new Error("expected one recent expense for B");
    expect(forB.myShareCents).toBe(500);
    expect(forB.myPaidCents).toBe(0);
  });

  it("counts unread per sender, and mark_read clears only the caller's count", async () => {
    const bootA1 = await rpcOk<BootstrapPayload>(authenticateAs(userA), "bootstrap", {});
    const before = bootA1.groups.find((g) => g.group.id === g1);
    if (!before) throw new Error("G1 missing from A's bootstrap");
    expect(before.unreadCount).toBe(1);
    expect(before.lastMessage).toEqual({
      content: MSG_B,
      senderId: userB.id,
      createdAt: msgB.createdAt,
    });

    const { error } = await rpc(authenticateAs(userA), "mark_read", {
      p_group_id: g1,
    });
    expect(error).toBeNull();

    const bootA2 = await rpcOk<BootstrapPayload>(authenticateAs(userA), "bootstrap", {});
    const after = bootA2.groups.find((g) => g.group.id === g1);
    if (!after) throw new Error("G1 missing from A's bootstrap after mark_read");
    expect(after.unreadCount).toBe(0);

    // B never marked read: A's message is still unread for B.
    const bootB = await rpcOk<BootstrapPayload>(authenticateAs(userB), "bootstrap", {});
    const forB = bootB.groups.find((g) => g.group.id === g1);
    if (!forB) throw new Error("G1 missing from B's bootstrap");
    expect(forB.unreadCount).toBe(1);
  });

  it("get_expense rejects an outsider with not_a_member", async () => {
    const code = await expectRpcError(
      authenticateAs(userX).rpc("get_expense", { p_expense_id: expenseId }),
    );
    expect(code).toBe("not_a_member");
  });

  it("get_expense returns ExpenseDetail with exact top-level keys and participants ordered", async () => {
    const detail = await rpcOk<ExpenseDetail>(
      authenticateAs(userB),
      "get_expense",
      { p_expense_id: expenseId },
    );
    expect(Object.keys(detail).sort()).toEqual([...EXPENSE_DETAIL_KEYS].sort());
    expect(detail.participants.map((p) => p.participantIndex)).toEqual([0, 1]);
    expect(detail.participants.map((p) => p.user?.id).sort()).toEqual(
      [userA.id, userB.id].sort(),
    );
    expect(detail.group.id).toBe(g1);
    expect(detail.current.versionNo).toBe(1);
    expect(detail.versions).toHaveLength(1);
  });

  it("get_conversation returns newest-first messages and events", async () => {
    const conv = await rpcOk<Conversation>(
      authenticateAs(userB),
      "get_conversation",
      { p_group_id: g1, p_before: null, p_limit: 50 },
    );
    expect(conv.messages).toHaveLength(2);
    expect(Object.keys(conv.messages[0]!).sort()).toEqual([...CHAT_MESSAGE_KEYS].sort());
    expect(conv.messages[0]!.content).toBe(MSG_B);
    expect(conv.messages[0]!.sender.handle).toBe(userB.handle);
    expect(conv.messages[1]!.content).toBe(MSG_A);
    expect(conv.messages[1]!.sender.handle).toBe(userA.handle);

    const expenseCreated = conv.events.find((e) => e.kind === "expense_created");
    if (!expenseCreated) throw new Error("expense_created event missing");
    expect(expenseCreated.expenseTitle).toBe(EXPENSE_TITLE);
    expect(expenseCreated.actor?.id).toBe(userA.id);
  });

  it("get_conversation enforces strictness of the p_before boundary", async () => {
    const page = await rpcOk<Conversation>(
      authenticateAs(userB),
      "get_conversation",
      { p_group_id: g1, p_before: msgA.createdAt, p_limit: 50 },
    );
    expect(page.messages).toHaveLength(0);
    expect(page.messages.some((m) => m.id === msgA.id)).toBe(false);
  });

  it("get_activity merges events from both groups with ids strictly descending", async () => {
    const events = await rpcOk<GroupEvent[]>(
      authenticateAs(userA),
      "get_activity",
      { p_before_id: null, p_limit: 50 },
    );
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1]!.id).toBeGreaterThan(events[i]!.id);
    }
    const hasG1 = events.some((e) => e.groupId === g1);
    const hasG2 = events.some((e) => e.groupId === g2);
    expect(hasG1).toBe(true);
    expect(hasG2).toBe(true);
  });

  it("get_group_expenses returns the group's expenses", async () => {
    const list = await rpcOk<ExpenseSummary[]>(
      authenticateAs(userA),
      "get_group_expenses",
      { p_group_id: g1, p_before: null, p_limit: 30 },
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(expenseId);
  });

  it("send_message is idempotent on client id", async () => {
    const clientId = crypto.randomUUID();
    const first = await rpcOk<ChatMessage>(authenticateAs(userA), "send_message", {
      p_client_id: clientId,
      p_group_id: g1,
      p_content: "mensagem repetida",
    });
    const second = await rpcOk<ChatMessage>(authenticateAs(userA), "send_message", {
      p_client_id: clientId,
      p_group_id: g1,
      p_content: "mensagem repetida",
    });
    expect(second.id).toBe(first.id);

    const conv = await rpcOk<Conversation>(
      authenticateAs(userA),
      "get_conversation",
      { p_group_id: g1, p_before: null, p_limit: 50 },
    );
    // 2 fixture messages + 1 idempotent message = 3 messages total
    expect(conv.messages).toHaveLength(3);
  });

  it("send_message rejects empty content with invalid_argument", async () => {
    const code = await expectRpcError(
      authenticateAs(userA).rpc("send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: g1,
        p_content: "",
      }),
    );
    expect(code).toBe("invalid_argument");
  });

  it.each(PUBLIC_TABLES)(
    "denies authenticated SELECT on table %s with code 42501",
    async (table) => {
      const { error } = await authenticateAs(userA).from(table).select("*").limit(1);
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    },
  );

  it("denies anon SELECT on users and groups with code 42501", async () => {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    for (const table of ["users", "groups"] as const) {
      const { error } = await anon.from(table).select("*").limit(1);
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    }
  });
});

describe.skipIf(!isIntegrationTestReady)(
  "ledger read RPCs — invited viewer scoping",
  () => {
    let inviter!: TestUser;
    let invited!: TestUser;
    let member!: TestUser;
    let groupId!: string;

    const MESSAGE = "mensagem para aceitos";

    beforeAll(async () => {
      [inviter, invited, member] = await createTestUsers(3);

      groupId = (await createGroup(inviter, "Convite restrito", [invited.id, member.id]))
        .groupId;
      await acceptInvitation(member, groupId);

      await createExpense(inviter, {
        groupId,
        title: "Churrasco fechado",
        totalCents: 1000,
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: inviter.id },
            { kind: "user", userId: member.id },
            { kind: "guest", guestId: null, displayName: "Zé" },
          ],
          shares: [333, 333, 334],
          payers: [{ participantIndex: 0, amountCents: 1000 }],
          itemAssignments: null,
        },
      });

      await rpcOk<{ settlementId: string }>(authenticateAs(member), "record_settlement", {
        p_operation_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_from_user_id: member.id,
        p_to_user_id: inviter.id,
        p_amount_cents: 100,
      });
      await rpcOk<ChatMessage>(authenticateAs(inviter), "send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_content: MESSAGE,
      });
    });

    it("shows an invited viewer only their invitation: no money, guests or chat", async () => {
      const snap = await rpcOk<GroupSnapshot>(authenticateAs(invited), "get_group", {
        p_group_id: groupId,
      });
      expect(snap.balances).toEqual([]);
      expect(snap.guests).toEqual([]);
      expect(snap.settlements).toEqual([]);
      expect(snap.recentExpenses).toEqual([]);
      expect(snap.unreadCount).toBe(0);
      expect(snap.lastMessage).toBeNull();
      expect(snap.members.map((m) => m.userId).sort()).toEqual(
        [invited.id, inviter.id].sort(),
      );
      const invitedRow = snap.members.find((m) => m.userId === invited.id);
      expect(invitedRow?.status).toBe("invited");
      expect(invitedRow?.invitedBy).toBe(inviter.id);
    });

    it("still exposes the full snapshot to an accepted member", async () => {
      const snap = await rpcOk<GroupSnapshot>(authenticateAs(member), "get_group", {
        p_group_id: groupId,
      });
      expect(snap.members.map((m) => m.userId).sort()).toEqual(
        [inviter.id, invited.id, member.id].sort(),
      );
      expect(snap.balances).toHaveLength(3);
      expect(snap.guests).toHaveLength(1);
      expect(snap.settlements).toHaveLength(1);
      expect(snap.recentExpenses).toHaveLength(1);
      expect(snap.unreadCount).toBe(1);
      expect(snap.lastMessage?.content).toBe(MESSAGE);
    });

    it("applies the same invitation scoping inside bootstrap", async () => {
      const boot = await rpcOk<BootstrapPayload>(authenticateAs(invited), "bootstrap", {});
      const snap = boot.groups.find((g) => g.group.id === groupId);
      if (!snap) throw new Error("invited group missing from bootstrap");
      expect(snap.balances).toEqual([]);
      expect(snap.guests).toEqual([]);
      expect(snap.settlements).toEqual([]);
      expect(snap.recentExpenses).toEqual([]);
      expect(snap.unreadCount).toBe(0);
      expect(snap.lastMessage).toBeNull();
      expect(snap.members.map((m) => m.userId).sort()).toEqual(
        [invited.id, inviter.id].sort(),
      );
    });
  },
);
