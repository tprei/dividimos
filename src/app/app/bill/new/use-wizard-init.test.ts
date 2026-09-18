import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/app-store";
import { useBillStore } from "@/stores/bill-store";
import type { ExpenseDetail, ExpenseVersion, GroupSnapshot, Me } from "@/types/ledger";
import { ensureDraftOwnedBy, selectDraftForType, useWizardInit } from "./use-wizard-init";
import { readDraftIntent } from "@/lib/draft-intent";
import { setDraftOwner } from "@/lib/bill-draft-isolation";

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }));
vi.mock("@/lib/sync/refresh", () => ({ refreshExpense: vi.fn() }));

const me: Me = {
  id: "user-me",
  handle: "alice",
  name: "Alice Souza",
  avatarUrl: null,
  isBot: false,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

const other = {
  id: "user-other",
  handle: "bob",
  name: "Bob Silva",
  avatarUrl: null,
  isBot: false,
};

function groupSnapshot(): GroupSnapshot {
  return {
    group: {
      id: "group-1",
      kind: "group",
      name: "Casa",
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      {
        groupId: "group-1",
        userId: me.id,
        status: "accepted",
        invitedBy: null,
        acceptedAt: null,
        user: me,
      },
      {
        groupId: "group-1",
        userId: other.id,
        status: "accepted",
        invitedBy: me.id,
        acceptedAt: "2026-01-01T00:00:00Z",
        user: other,
      },
    ],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00Z",
    expenseCount: 0,
    pairwiseEdges: [],
  };
}

function renderInit(overrides: Partial<Parameters<typeof useWizardInit>[0]> = {}) {
  return renderHook(() =>
    useWizardInit({
      modes: {
        dm: null,
        chatDraft: {
          groupId: "group-1",
          title: "Jantar",
          amountCents: 10000,
          expenseType: "single_amount",
          participantIds: [me.id, other.id],
          payerId: other.id,
        },
        editExpenseId: null,
        entryGroupId: "group-1",
        entryStep: null,
      },
      me,
      step: "participants",
      onSetPendingGroupId: vi.fn(),
      onSetBillType: vi.fn(),
      onSetStep: vi.fn(),
      onSetIsEditing: vi.fn(),
      onSetIsDmMode: vi.fn(),
      ...overrides,
    }),
  );
}

describe("useWizardInit chat actors", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
    useAppStore.setState({
      me,
      groups: { "group-1": groupSnapshot() },
      groupOrder: ["group-1"],
    });
  });

  it("hydrates only current group actors and opens the draft", () => {
    const onSetStep = vi.fn();
    renderInit({ onSetStep });

    const state = useBillStore.getState();
    expect(state.participants.map((participant) => participant.id)).toEqual([me.id, other.id]);
    expect(state.billSplits.map((split) => split.userId)).toEqual([me.id, other.id]);
    expect(state.payers).toMatchObject([{ userId: other.id, amountCents: 10000 }]);
    expect(onSetStep).toHaveBeenCalledWith("info");
  });

  it("fails closed before creating a draft when an actor is stale", () => {
    renderInit({
      modes: {
        dm: null,
        chatDraft: {
          groupId: "group-1",
          title: "Jantar",
          amountCents: 10000,
          expenseType: "single_amount",
          participantIds: [me.id, "stale-user"],
          payerId: me.id,
        },
        editExpenseId: null,
        entryGroupId: "group-1",
        entryStep: null,
      },
    });

    expect(useBillStore.getState().expense).toBeNull();
  });

  it("seeds the group's accepted members when the URL names no actors", () => {
    renderInit({
      modes: {
        dm: null,
        chatDraft: {
          groupId: "group-1",
          title: "Uber",
          amountCents: 2500,
          expenseType: "single_amount",
        },
        editExpenseId: null,
        entryGroupId: "group-1",
        entryStep: null,
      },
    });

    // Without an actor set there is nothing to reject, so the draft opens with
    // the group as any other new bill would.
    const participantIds = useBillStore.getState().participants.map((p) => p.id);
    expect(participantIds).toContain(other.id);
    expect(useBillStore.getState().expense).not.toBeNull();
  });

  it("records edit draft intent when hydrating an existing expense for editing", () => {
    const editId = "exp-edit-1";
    const currentVersion: ExpenseVersion = {
      expenseId: editId,
      versionNo: 3,
      authorId: me.id,
      createdAt: "2026-09-01T00:00:00Z",
      changeSummary: null,
      occurredOn: "2026-09-01",
      title: "Almoço de Trabalho",
      merchantName: null,
      expenseType: "single_amount",
      totalCents: 6000,
      serviceFeeBasisPoints: 0,
      fixedFeeCents: 0,
      payload: {
        items: [],
        itemAssignments: [],
        participants: [{ kind: "user", userId: me.id }],
        shares: [6000],
        payers: [{ participantIndex: 0, amountCents: 6000 }],
      },
    };

    useAppStore.setState({
      me,
      groups: { "group-1": groupSnapshot() },
      groupOrder: ["group-1"],
      expenseDetails: {
        [editId]: {
          expense: {
            id: editId,
            groupId: "group-1",
            creatorId: me.id,
            status: "active",
            currentVersionNo: 3,
            occurredOn: "2026-09-01",
            createdAt: "2026-09-01T00:00:00Z",
            deletedAt: null,
            deletedBy: null,
          },
          current: currentVersion,
          versions: [currentVersion],
          participants: [
            {
              participantIndex: 0,
              kind: "user",
              user: me,
              guest: null,
              shareCents: 6000,
              paidCents: 6000,
            },
          ],
          group: { id: "group-1", name: "Amigos", kind: "group" },
        } satisfies ExpenseDetail,
      },
    });

    renderInit({
      modes: {
        dm: null,
        chatDraft: null,
        editExpenseId: editId,
        entryGroupId: "group-1",
        entryStep: null,
      },
    });

    const intent = readDraftIntent();
    expect(intent).toMatchObject({
      kind: "edit",
      expenseId: editId,
      expectedVersionNo: 3,
    });
  });
});


describe("draft ownership", () => {
  it("resets the live draft when another account owns the persisted one", () => {
    const store = useBillStore.getState();
    store.setCurrentUser({
      id: "user-a",
      email: "a@example.com",
      handle: "alice",
      name: "Alice",
      pixKeyType: "email",
      pixKeyHint: "",
      onboarded: true,
      createdAt: "",
    });
    store.createExpense("Churrasco", "itemized");
    setDraftOwner("user-a");

    ensureDraftOwnedBy("user-b");
    expect(useBillStore.getState().expense).toBeNull();
  });
});

describe("selectDraftForType", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
    useBillStore.getState().setCurrentUser({
      id: "user-alice",
      email: "alice@example.com",
      handle: "alice",
      name: "Alice",
      pixKeyType: "email",
      pixKeyHint: "",
      onboarded: true,
      createdAt: "",
    });
  });

  it("keeps the work already in the draft when the same type is picked again", () => {
    const store = useBillStore.getState();
    selectDraftForType(store, "itemized", null);

    const started = useBillStore.getState();
    started.addItem({
      description: "Picanha",
      quantity: 1,
      unitPriceCents: 9000,
      totalPriceCents: 9000,
    });
    started.addGuest("Bia");
    const draftId = useBillStore.getState().expense?.id;
    const draftKey = useBillStore.getState().draftKey;

    // Back to the type step, then forward again on the same type.
    selectDraftForType(useBillStore.getState(), "itemized", null);

    const after = useBillStore.getState();
    expect(after.expense?.id).toBe(draftId);
    expect(after.draftKey).toBe(draftKey);
    expect(after.items).toHaveLength(1);
    expect(after.guests).toHaveLength(1);
  });

  it("starts a fresh draft when the user switches to the other type", () => {
    selectDraftForType(useBillStore.getState(), "itemized", null);
    useBillStore.getState().addItem({
      description: "Picanha",
      quantity: 1,
      unitPriceCents: 9000,
      totalPriceCents: 9000,
    });

    selectDraftForType(useBillStore.getState(), "single_amount", null);

    const after = useBillStore.getState();
    expect(after.expense?.expenseType).toBe("single_amount");
    expect(after.items).toHaveLength(0);
  });

  it("seeds a group chosen before the draft started", () => {
    selectDraftForType(useBillStore.getState(), "itemized", "group-1");
    expect(useBillStore.getState().expense?.groupId).toBe("group-1");
  });

  it("preserves expense.groupId across step transitions when returning to type step and re-selecting itemized", () => {
    const store = useBillStore.getState();
    store.createExpense("Churrasco", "itemized", undefined, "group-praia");
    selectDraftForType(useBillStore.getState(), "itemized", null);
    expect(useBillStore.getState().expense?.groupId).toBe("group-praia");
  });
});
