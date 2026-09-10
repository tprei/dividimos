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
  withPg,
  getBalances,
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
  expenseCount: number;
  pairwiseEdges: Array<{
    fromKind: string;
    fromId: string;
    toId: string;
    amountCents: number;
  }>;
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

interface ExpensePageWire {
  expenses: ExpenseSummary[];
  nextCursor: { createdAt: string; id: string } | null;
  complete: boolean;
  total: number;
}

interface PageCursorWire {
  createdAt: string;
  id: string | number;
}

interface Conversation {
  messages: ChatMessage[];
  messageCursor: PageCursorWire | null;
  messagesComplete: boolean;
  events: GroupEvent[];
  eventCursor: PageCursorWire | null;
  eventsComplete: boolean;
  readWatermark: { lastReadAt: string; lastReadMessageId: string } | null;
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
  "expenseCount",
  "pairwiseEdges",
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

  it("reports the active expense count instead of the recent preview length", async () => {
    const [countUser, countMember] = await createTestUsers(2);
    const countGroup = await createGroupWithMembers(
      countUser,
      [countMember],
      "Leitura de contagem",
    );
    await createExpense(countUser, {
      groupId: countGroup,
      title: "Despesa ativa",
      totalCents: 1000,
      payload: equalSplitPayload([countUser.id, countMember.id], 1000),
    });
    const deleted = await createExpense(countUser, {
      groupId: countGroup,
      title: "Despesa removida",
      totalCents: 2000,
      payload: equalSplitPayload([countUser.id, countMember.id], 2000),
    });
    await rpcOk(authenticateAs(countUser), "delete_expense", {
      p_expense_id: deleted.expenseId,
    });

    const snap = await rpcOk<GroupSnapshot>(authenticateAs(countUser), "get_group", {
      p_group_id: countGroup,
    });
    expect(snap.expenseCount).toBe(1);
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
      p_last_read_message_id: msgB.id,
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

  it("get_conversation returns a newest-first envelope with the exact keys", async () => {
    const conv = await rpcOk<Conversation>(
      authenticateAs(userB),
      "get_conversation",
      { p_group_id: g1, p_limit: 50 },
    );
    expect(Object.keys(conv).sort()).toEqual(
      [
        "eventCursor",
        "events",
        "eventsComplete",
        "messageCursor",
        "messages",
        "messagesComplete",
        "readWatermark",
      ].sort(),
    );
    expect(conv.messages).toHaveLength(2);
    expect(Object.keys(conv.messages[0]!).sort()).toEqual([...CHAT_MESSAGE_KEYS].sort());
    expect(conv.messages[0]!.content).toBe(MSG_B);
    expect(conv.messages[1]!.content).toBe(MSG_A);
    expect(conv.messagesComplete).toBe(true);
    expect(conv.messageCursor).toBeNull();

    const expenseCreated = conv.events.find((e) => e.kind === "expense_created");
    if (!expenseCreated) throw new Error("expense_created event missing");
    expect(expenseCreated.expenseTitle).toBe(EXPENSE_TITLE);
  });

  it("get_conversation applies a strict (created_at, id) message boundary", async () => {
    const page = await rpcOk<Conversation>(
      authenticateAs(userB),
      "get_conversation",
      {
        p_group_id: g1,
        p_message_before_created_at: msgA.createdAt,
        p_message_before_id: msgA.id,
        p_limit: 50,
      },
    );
    // msgA is the oldest message, and the boundary is strict.
    expect(page.messages).toHaveLength(0);
    expect(page.messagesComplete).toBe(true);
  });

  it("get_conversation rejects outsiders, half cursors and out-of-range limits", async () => {
    expect(
      await expectRpcError(
        authenticateAs(userX).rpc("get_conversation", { p_group_id: g1, p_limit: 50 }),
      ),
    ).toBe("not_a_member");

    for (const args of [
      { p_group_id: g1, p_message_before_created_at: msgA.createdAt },
      { p_group_id: g1, p_message_before_id: msgA.id },
      { p_group_id: g1, p_event_before_created_at: msgA.createdAt },
      { p_group_id: g1, p_event_before_id: 1 },
    ]) {
      expect(
        await expectRpcError(authenticateAs(userB).rpc("get_conversation", args)),
      ).toBe("invalid_argument");
    }

    for (const limit of [0, 101]) {
      expect(
        await expectRpcError(
          authenticateAs(userB).rpc("get_conversation", { p_group_id: g1, p_limit: limit }),
        ),
      ).toBe("invalid_argument");
    }
  });

  it("get_conversation echoes the caller's own read watermark", async () => {
    const withoutReceipt = await rpcOk<Conversation>(
      authenticateAs(userB),
      "get_conversation",
      { p_group_id: g1, p_limit: 50 },
    );
    expect(withoutReceipt.readWatermark).toBeNull();

    const { error } = await rpc(authenticateAs(userB), "mark_read", {
      p_group_id: g1,
      p_last_read_message_id: msgA.id,
    });
    expect(error).toBeNull();

    const afterReceipt = await rpcOk<Conversation>(
      authenticateAs(userB),
      "get_conversation",
      { p_group_id: g1, p_limit: 50 },
    );
    expect(afterReceipt.readWatermark?.lastReadMessageId).toBe(msgA.id);

    // The watermark is per caller: A's receipt must not leak into B's envelope.
    const forA = await rpcOk<Conversation>(
      authenticateAs(userA),
      "get_conversation",
      { p_group_id: g1, p_limit: 50 },
    );
    expect(forA.readWatermark?.lastReadMessageId).not.toBe(msgA.id);
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

  it("get_group_expenses returns a cursored envelope with the group total", async () => {
    const page = await rpcOk<ExpensePageWire>(
      authenticateAs(userA),
      "get_group_expenses",
      { p_group_id: g1, p_limit: 30 },
    );
    expect(Object.keys(page).sort()).toEqual(
      ["complete", "expenses", "nextCursor", "total"].sort(),
    );
    expect(page.expenses).toHaveLength(1);
    expect(page.expenses[0]!.id).toBe(expenseId);
    expect(page.complete).toBe(true);
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(1);
  });

  it("get_group_expenses rejects outsiders, half cursors and bad limits", async () => {
    expect(
      await expectRpcError(
        authenticateAs(userX).rpc("get_group_expenses", { p_group_id: g1, p_limit: 30 }),
      ),
    ).toBe("not_a_member");

    expect(
      await expectRpcError(
        authenticateAs(userA).rpc("get_group_expenses", {
          p_group_id: g1,
          p_before_created_at: "2026-09-01T00:00:00Z",
        }),
      ),
    ).toBe("invalid_argument");

    expect(
      await expectRpcError(
        authenticateAs(userA).rpc("get_group_expenses", { p_group_id: g1, p_limit: 0 }),
      ),
    ).toBe("invalid_argument");
  });

  it("get_my_expenses pages across groups with a total beyond the page", async () => {
    const pagingGroup = await createGroupWithMembers(userA, [userB], "Histórico");
    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const ack = await createExpense(userA, {
        groupId: pagingGroup,
        title: `Despesa ${i}`,
        totalCents: 1000 + i,
        payload: equalSplitPayload([userA.id, userB.id], 1000 + i),
      });
      created.push(ack.expenseId);
    }

    const first = await rpcOk<ExpensePageWire>(authenticateAs(userA), "get_my_expenses", {
      p_limit: 2,
    });
    expect(first.expenses).toHaveLength(2);
    expect(first.complete).toBe(false);
    expect(first.nextCursor).not.toBeNull();
    // The total spans every visible group, not this page.
    expect(first.total).toBeGreaterThan(2);

    const seen = new Set(first.expenses.map((e) => e.id));
    let cursor = first.nextCursor;
    let complete = first.complete;
    let guard = 0;
    while (!complete) {
      const next: ExpensePageWire = await rpcOk<ExpensePageWire>(
        authenticateAs(userA),
        "get_my_expenses",
        {
          p_limit: 2,
          p_before_created_at: cursor!.createdAt,
          p_before_id: cursor!.id,
        },
      );
      for (const row of next.expenses) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = next.nextCursor;
      complete = next.complete;
      if (++guard > 20) throw new Error("cursor walk failed to terminate");
    }

    expect(seen.size).toBe(first.total);
    for (const id of created) expect(seen.has(id)).toBe(true);

    // Another member's unrelated group must not appear for this caller.
    const outsider = await rpcOk<ExpensePageWire>(authenticateAs(userX), "get_my_expenses", {
      p_limit: 50,
    });
    expect(outsider.expenses.some((e: ExpenseSummary) => created.includes(e.id))).toBe(false);
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
      { p_group_id: g1, p_limit: 50 },
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

  it("pages every message exactly once when many share a created_at", async () => {
    // A dedicated group keeps the shared-timestamp rows away from the other
    // tests' fixtures.
    const pagingGroup = await createGroupWithMembers(userA, [userB], "Paginação");
    const total = 55;
    const sent: string[] = [];
    for (let i = 0; i < total; i++) {
      const row = await rpcOk<ChatMessage>(authenticateAs(userB), "send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: pagingGroup,
        p_content: `mensagem ${i}`,
      });
      sent.push(row.id);
    }

    // Collapse most of them onto one instant so the id tiebreak is what makes
    // the cursor walk deterministic.
    await withPg((pg) =>
      pg.query(
        "update chat_messages set created_at = (select min(created_at) from chat_messages where group_id = $1) where group_id = $1 and id <> $2",
        [pagingGroup, sent[sent.length - 1]],
      ),
    );

    const seen: string[] = [];
    let cursor: PageCursorWire | null = null;
    let complete = false;
    let pages = 0;

    while (!complete) {
      const args: Record<string, unknown> = { p_group_id: pagingGroup, p_limit: 10 };
      if (cursor !== null) {
        args.p_message_before_created_at = cursor.createdAt;
        args.p_message_before_id = cursor.id;
      }
      const conv: Conversation = await rpcOk<Conversation>(
        authenticateAs(userA),
        "get_conversation",
        args,
      );
      seen.push(...conv.messages.map((m) => m.id));
      cursor = conv.messageCursor;
      complete = conv.messagesComplete;
      pages += 1;
      if (pages > 20) throw new Error("cursor walk failed to terminate");
    }

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect([...seen].sort()).toEqual([...sent].sort());
    // 55 rows at 10 per page: completion flips only on the final page.
    expect(pages).toBe(6);
  });
  it("validates incoming read watermarks and preserves tuple order", async () => {
    expect(
      await expectRpcError(
        authenticateAs(userX).rpc("mark_read", {
          p_group_id: g1,
          p_last_read_message_id: msgB.id,
        }),
      ),
    ).toBe("not_a_member");

    expect(
      await expectRpcError(
        authenticateAs(userA).rpc("mark_read", {
          p_group_id: g2,
          p_last_read_message_id: msgB.id,
        }),
      ),
    ).toBe("invalid_argument");

    expect(
      await expectRpcError(
        authenticateAs(userA).rpc("mark_read", {
          p_group_id: g1,
          p_last_read_message_id: msgA.id,
        }),
      ),
    ).toBe("invalid_argument");

    const older = await rpcOk<ChatMessage>(authenticateAs(userB), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: g1,
      p_content: "watermark older",
    });
    const newer = await rpcOk<ChatMessage>(authenticateAs(userB), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: g1,
      p_content: "watermark newer",
    });

    const mark = async (messageId: string) => {
      const { error } = await rpc(authenticateAs(userA), "mark_read", {
        p_group_id: g1,
        p_last_read_message_id: messageId,
      });
      expect(error).toBeNull();
    };

    await mark(newer.id);
    await mark(older.id);
    const receiptAfterOlder = await withPg(async (pg) => {
      const result = await pg.query<{ last_read_message_id: string }>(
        "select last_read_message_id from conversation_reads where user_id = $1 and group_id = $2",
        [userA.id, g1],
      );
      return result.rows[0]?.last_read_message_id;
    });
    expect(receiptAfterOlder).toBe(newer.id);

    const equalOne = await rpcOk<ChatMessage>(authenticateAs(userB), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: g1,
      p_content: "same timestamp one",
    });
    const equalTwo = await rpcOk<ChatMessage>(authenticateAs(userB), "send_message", {
      p_client_id: crypto.randomUUID(),
      p_group_id: g1,
      p_content: "same timestamp two",
    });
    // The pair must share a timestamp strictly ahead of the existing receipt
    // watermark: only then does the first mark advance and the second one
    // exercise the equal-timestamp UUID tie-break instead of being rejected
    // as a regression.
    const sharedTimestamp = await withPg(async (pg) => {
      const result = await pg.query<{ shared: string }>(
        "select (now() + interval '1 hour')::text as shared",
      );
      return result.rows[0]!.shared;
    });
    await withPg((pg) =>
      pg.query(
        "update chat_messages set created_at = $1 where id = any($2::uuid[])",
        [sharedTimestamp, [equalOne.id, equalTwo.id]],
      ),
    );

    const [highId, lowId] =
      equalOne.id > equalTwo.id ? [equalOne.id, equalTwo.id] : [equalTwo.id, equalOne.id];
    await mark(highId);
    await mark(lowId);
    const receiptAfterEqualTimestamp = await withPg(async (pg) => {
      const result = await pg.query<{ last_read_message_id: string }>(
        "select last_read_message_id from conversation_reads where user_id = $1 and group_id = $2",
        [userA.id, g1],
      );
      return result.rows[0]?.last_read_message_id;
    });
    expect(receiptAfterEqualTimestamp).toBe(highId);

    const concurrent = await Promise.all([
      rpcOk<ChatMessage>(authenticateAs(userA), "send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: g1,
        p_content: "concurrent A",
      }),
      rpcOk<ChatMessage>(authenticateAs(userB), "send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: g1,
        p_content: "concurrent B",
      }),
    ]);
    const storedConcurrent = await withPg(async (pg) => {
      const result = await pg.query<{ id: string; created_at: string }>(
        "select id, created_at::text from chat_messages where id = any($1::uuid[]) order by created_at, id",
        [concurrent.map((message) => message.id)],
      );
      return result.rows;
    });
    expect(storedConcurrent).toHaveLength(2);
    expect(storedConcurrent[0]?.created_at).not.toBe(storedConcurrent[1]?.created_at);
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
      expect(snap.expenseCount).toBe(0);
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
      expect(snap.expenseCount).toBe(1);
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
      expect(snap.expenseCount).toBe(0);
      expect(snap.unreadCount).toBe(0);
      expect(snap.lastMessage).toBeNull();
      expect(snap.members.map((m) => m.userId).sort()).toEqual(
        [invited.id, inviter.id].sort(),
      );
    });
  },
);

describe.skipIf(!isIntegrationTestReady)(
  "expense payload integrity — server-side arithmetic",
  () => {
    it("refuses an item whose stated total contradicts quantity x unit price", async () => {
      const [alice, bob] = await createTestUsers(2);
      const groupId = await createGroupWithMembers(alice, [bob]);
      const code = await expectRpcError(
        authenticateAs(alice).rpc("create_expense", {
          p_client_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_occurred_on: "2026-01-10",
          p_title: "Café",
          p_merchant_name: "",
          p_expense_type: "itemized",
          p_total_cents: 9000,
          p_service_fee_bps: 0,
          p_fixed_fee_cents: 0,
          p_payload: {
            items: [
              {
                description: "cappuccino",
                quantityMilliunits: 1000,
                unitPriceCents: 100,
                totalPriceCents: 9000,
              },
            ],
            participants: [
              { kind: "user", userId: alice.id },
              { kind: "user", userId: bob.id },
            ],
            shares: [4500, 4500],
            payers: [{ participantIndex: 0, amountCents: 9000 }],
            itemAssignments: [
              { itemIndex: 0, participantIndex: 0, amountCents: 9000 },
            ],
          },
        }),
      );
      expect(code).toBe("line_total_mismatch");
    });

    it("refuses item assignments that contradict the declared shares", async () => {
      const [alice, bob] = await createTestUsers(2);
      const groupId = await createGroupWithMembers(alice, [bob]);
      const code = await expectRpcError(
        authenticateAs(alice).rpc("create_expense", {
          p_client_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_occurred_on: "2026-01-10",
          p_title: "Mercado",
          p_merchant_name: "",
          p_expense_type: "itemized",
          p_total_cents: 10000,
          p_service_fee_bps: 0,
          p_fixed_fee_cents: 0,
          p_payload: {
            items: [
              {
                description: "arroz",
                quantityMilliunits: 1000,
                unitPriceCents: 5000,
                totalPriceCents: 5000,
              },
              {
                description: "feijão",
                quantityMilliunits: 1000,
                unitPriceCents: 5000,
                totalPriceCents: 5000,
              },
            ],
            participants: [
              { kind: "user", userId: alice.id },
              { kind: "user", userId: bob.id },
            ],
            shares: [6000, 4000],
            payers: [{ participantIndex: 0, amountCents: 10000 }],
            itemAssignments: [
              { itemIndex: 0, participantIndex: 0, amountCents: 3000 },
              { itemIndex: 0, participantIndex: 1, amountCents: 2000 },
              { itemIndex: 1, participantIndex: 0, amountCents: 2000 },
              { itemIndex: 1, participantIndex: 1, amountCents: 3000 },
            ],
          },
        }),
      );
      expect(code).toBe("item_assignment_share_mismatch");
    });

    it("accepts a legitimate itemized expense with fractional quantities and a service fee", async () => {
      const [alice, bob] = await createTestUsers(2);
      const groupId = await createGroupWithMembers(alice, [bob]);
      const created = await createExpense(alice, {
        groupId,
        title: "Hortifrúti",
        occurredOn: "2026-01-10",
        expenseType: "itemized",
        totalCents: 11000,
        serviceFeeBps: 1000,
        payload: {
          items: [
            {
              description: "tomate",
              quantityMilliunits: 1500,
              unitPriceCents: 4000,
              totalPriceCents: 6000,
            },
            {
              description: "cebola",
              quantityMilliunits: 3333,
              unitPriceCents: 1200,
              totalPriceCents: 4000,
            },
          ],
          participants: [
            { kind: "user", userId: alice.id },
            { kind: "user", userId: bob.id },
          ],
          shares: [6600, 4400],
          payers: [{ participantIndex: 0, amountCents: 11000 }],
          itemAssignments: [
            { itemIndex: 0, participantIndex: 0, amountCents: 2500 },
            { itemIndex: 0, participantIndex: 1, amountCents: 3500 },
            { itemIndex: 1, participantIndex: 0, amountCents: 3500 },
            { itemIndex: 1, participantIndex: 1, amountCents: 500 },
          ],
        },
      });
      expect(created.versionNo).toBe(1);
    });

    it("raises invalid_payload, never raw 22003, for overflowing numeric fields", async () => {
      const [alice, bob] = await createTestUsers(2);
      const groupId = await createGroupWithMembers(alice, [bob]);
      const aliceClient = authenticateAs(alice);
      const participants = [
        { kind: "user", userId: alice.id },
        { kind: "user", userId: bob.id },
      ];
      const cases = [
        {
          name: "share above int4 range",
          expenseType: "single_amount" as const,
          payload: {
            items: [],
            participants,
            shares: [3000000000, 100],
            payers: [{ participantIndex: 0, amountCents: 100 }],
            itemAssignments: null,
          },
        },
        {
          name: "payer amount above int4 range",
          expenseType: "single_amount" as const,
          payload: {
            items: [],
            participants,
            shares: [100, 0],
            payers: [{ participantIndex: 0, amountCents: 3000000000 }],
            itemAssignments: null,
          },
        },
        {
          name: "payer participantIndex above int4 range",
          expenseType: "single_amount" as const,
          payload: {
            items: [],
            participants,
            shares: [100, 0],
            payers: [{ participantIndex: 3000000000, amountCents: 100 }],
            itemAssignments: null,
          },
        },
        {
          name: "item assignment amount above int4 range",
          expenseType: "itemized" as const,
          payload: {
            items: [
              {
                description: "x",
                quantityMilliunits: 1000,
                unitPriceCents: 100,
                totalPriceCents: 100,
              },
            ],
            participants,
            shares: [100, 0],
            payers: [{ participantIndex: 0, amountCents: 100 }],
            itemAssignments: [
              { itemIndex: 0, participantIndex: 0, amountCents: 3000000000 },
            ],
          },
        },
        {
          name: "quantity above the milliunit cap",
          expenseType: "itemized" as const,
          payload: {
            items: [
              {
                description: "x",
                quantityMilliunits: 1e30,
                unitPriceCents: 0,
                totalPriceCents: 0,
              },
            ],
            participants,
            shares: [100, 0],
            payers: [{ participantIndex: 0, amountCents: 100 }],
            itemAssignments: [
              { itemIndex: 0, participantIndex: 0, amountCents: 100 },
            ],
          },
        },
      ];
      for (const testCase of cases) {
        const code = await expectRpcError(
          aliceClient.rpc("create_expense", {
            p_client_id: crypto.randomUUID(),
            p_group_id: groupId,
            p_occurred_on: "2026-01-10",
            p_title: "Overflow",
            p_merchant_name: "",
            p_expense_type: testCase.expenseType,
            p_total_cents: 100,
            p_service_fee_bps: 0,
            p_fixed_fee_cents: 0,
            p_payload: testCase.payload,
          }),
        );
        expect(code, testCase.name).toBe("invalid_payload");
      }
    });

    it("raises itemized_total_mismatch, never raw 22003, when the derived fee overflows int4", async () => {
      const [alice, bob] = await createTestUsers(2);
      const groupId = await createGroupWithMembers(alice, [bob]);
      const items = Array.from({ length: 100 }, (_, index) => ({
        description: `item ${index}`,
        quantityMilliunits: 1000,
        unitPriceCents: 99999999,
        totalPriceCents: 99999999,
      }));
      const code = await expectRpcError(
        authenticateAs(alice).rpc("create_expense", {
          p_client_id: crypto.randomUUID(),
          p_group_id: groupId,
          p_occurred_on: "2026-01-10",
          p_title: "Fee overflow",
          p_merchant_name: "",
          p_expense_type: "itemized",
          p_total_cents: 1,
          p_service_fee_bps: 10000,
          p_fixed_fee_cents: 0,
          p_payload: {
            items,
            participants: [
              { kind: "user", userId: alice.id },
              { kind: "user", userId: bob.id },
            ],
            shares: [1, 0],
            payers: [{ participantIndex: 0, amountCents: 1 }],
            itemAssignments: null,
          },
        }),
      );
      expect(code).toBe("itemized_total_mismatch");
    });
  },
);

describe.skipIf(!isIntegrationTestReady)(
  "historical re-materialisation after a legitimate departure",
  () => {
    it("keeps edit, delete and repair of E2 possible after A leaves with zero net (F4)", async () => {
      const [ay, bee, cee] = await createTestUsers(3);
      const groupId = await createGroupWithMembers(ay, [bee, cee], "F4");

      const balanceMap = async () => {
        const rows = await getBalances(groupId);
        return new Map(rows.map((r) => [r.participant_id, r.net_cents]));
      };

      await createExpense(ay, {
        groupId,
        title: "E1 — bee paid",
        occurredOn: "2026-01-10",
        totalCents: 10000,
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: ay.id },
            { kind: "user", userId: bee.id },
          ],
          shares: [5000, 5000],
          payers: [{ participantIndex: 1, amountCents: 10000 }],
          itemAssignments: null,
        },
      });
      const e2Payload = {
        items: [],
        participants: [
          { kind: "user", userId: ay.id },
          { kind: "user", userId: cee.id },
        ],
        shares: [5000, 5000],
        payers: [{ participantIndex: 0, amountCents: 10000 }],
        itemAssignments: null,
      };
      const e2 = await createExpense(ay, {
        groupId,
        title: "E2 — ay paid",
        occurredOn: "2026-01-10",
        totalCents: 10000,
        payload: e2Payload,
      });

      let balances = await balanceMap();
      expect(balances.get(bee.id)).toBe(5000);
      expect(balances.get(cee.id)).toBe(-5000);
      expect(balances.has(ay.id)).toBe(false);

      await rpcOk(authenticateAs(ay), "leave_group", { p_group_id: groupId });
      const stillMember = await withPg((pg) =>
        pg
          .query(
            "select 1 from group_members where group_id = $1 and user_id = $2 and status = 'accepted'",
            [groupId, ay.id],
          )
          .then((r) => r.rowCount),
      );
      expect(stillMember).toBe(0);

      await rpcOk(authenticateAs(cee), "edit_expense", {
        p_expense_id: e2.expenseId,
        p_expected_version_no: 1,
        p_occurred_on: "2026-01-10",
        p_title: "E2 — ay paid (editada)",
        p_merchant_name: "",
        p_expense_type: "single_amount",
        p_total_cents: 10000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_payload: e2Payload,
      });
      const versionAfterEdit = await withPg((pg) =>
        pg
          .query<{ current_version_no: number }>(
            "select current_version_no from expenses where id = $1",
            [e2.expenseId],
          )
          .then((r) => r.rows[0]?.current_version_no),
      );
      expect(versionAfterEdit).toBe(2);
      expect(
        await withPg((pg) =>
          pg
            .query<{ user_id: string }>(
              "select user_id from expense_participants " +
                "where expense_id = $1 order by participant_index",
              [e2.expenseId],
            )
            .then((r) => r.rows.map((row) => row.user_id)),
        ),
      ).toEqual([ay.id, cee.id]);
      balances = await balanceMap();
      expect(balances.get(bee.id)).toBe(5000);
      expect(balances.get(cee.id)).toBe(-5000);
      expect(balances.has(ay.id)).toBe(false);

      await rpcOk(authenticateAs(cee), "delete_expense", {
        p_expense_id: e2.expenseId,
      });
      const liveRowsAfterDelete = await withPg((pg) =>
        pg
          .query<{ n: number }>(
            "select count(*)::int as n from expense_participants where expense_id = $1",
            [e2.expenseId],
          )
          .then((r) => r.rows[0].n),
      );
      expect(liveRowsAfterDelete).toBe(0);
      balances = await balanceMap();
      expect(balances.get(ay.id)).toBe(-5000);
      expect(balances.get(bee.id)).toBe(5000);

      await rpcOk(authenticateAs(cee), "restore_expense", {
        p_expense_id: e2.expenseId,
      });
      expect(
        await withPg((pg) =>
          pg
            .query<{ user_id: string }>(
              "select user_id from expense_participants " +
                "where expense_id = $1 order by participant_index",
              [e2.expenseId],
            )
            .then((r) => r.rows.map((row) => row.user_id)),
        ),
      ).toEqual([ay.id, cee.id]);
      const memberStatusAfterRestore = await withPg((pg) =>
        pg
          .query(
            "select 1 from group_members where group_id = $1 and user_id = $2",
            [groupId, ay.id],
          )
          .then((r) => r.rowCount),
      );
      expect(memberStatusAfterRestore).toBe(0);
      balances = await balanceMap();
      expect(balances.get(bee.id)).toBe(5000);
      expect(balances.get(cee.id)).toBe(-5000);
      expect(balances.has(ay.id)).toBe(false);
    });

    it("rejects participants outside the group but accepts a pending invitee", async () => {
      const [carol, alicia, draco, eve] = await createTestUsers(4);
      const groupId = await createGroupWithMembers(carol, [alicia]);
      await rpcOk(authenticateAs(carol), "invite_member", {
        p_group_id: groupId,
        p_user_id: draco.id,
      });
      await rpcOk(authenticateAs(alicia), "leave_group", { p_group_id: groupId });

      const carolClient = authenticateAs(carol);
      const e3 = await createExpense(carol, {
        groupId,
        title: "E3 — só carol",
        occurredOn: "2026-01-10",
        totalCents: 1000,
        payload: {
          items: [],
          participants: [{ kind: "user", userId: carol.id }],
          shares: [1000],
          payers: [{ participantIndex: 0, amountCents: 1000 }],
          itemAssignments: null,
        },
      });

      const editAdding = (userId: string) =>
        carolClient.rpc("edit_expense", {
          p_expense_id: e3.expenseId,
          p_expected_version_no: 1,
          p_occurred_on: "2026-01-10",
          p_title: "E3 — só carol",
          p_merchant_name: "",
          p_expense_type: "single_amount",
          p_total_cents: 1000,
          p_service_fee_bps: 0,
          p_fixed_fee_cents: 0,
          p_payload: {
            items: [],
            participants: [
              { kind: "user", userId: carol.id },
              { kind: "user", userId },
            ],
            shares: [500, 500],
            payers: [{ participantIndex: 0, amountCents: 1000 }],
            itemAssignments: null,
          },
        });

      expect(await expectRpcError(editAdding(alicia.id))).toBe("not_a_member");
      expect(
        await expectRpcError(
          carolClient.rpc("create_expense", {
            p_client_id: crypto.randomUUID(),
            p_group_id: groupId,
            p_occurred_on: "2026-01-10",
            p_title: "Eve nunca viu",
            p_merchant_name: "",
            p_expense_type: "single_amount",
            p_total_cents: 1000,
            p_service_fee_bps: 0,
            p_fixed_fee_cents: 0,
            p_payload: {
              items: [],
              participants: [
                { kind: "user", userId: carol.id },
                { kind: "user", userId: eve.id },
              ],
              shares: [500, 500],
              payers: [{ participantIndex: 0, amountCents: 1000 }],
              itemAssignments: null,
            },
          }),
        ),
      ).toBe("not_a_member");

      const { error: pendingError } = await editAdding(draco.id);
      expect(pendingError).toBeNull();
    });
  },
);
