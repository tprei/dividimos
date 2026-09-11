import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/app-store";
import { useBillStore } from "@/stores/bill-store";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { selectDraftForType, useWizardInit } from "./use-wizard-init";

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }));
vi.mock("@/lib/sync/refresh", () => ({ refreshExpense: vi.fn() }));

const me: Me = {
  id: "user-me",
  handle: "alice",
  name: "Alice Souza",
  avatarUrl: null,
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
      selectedGroupId: null,
      onSetSelectedGroupId: vi.fn(),
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

  it("attaches a group chosen after the draft started", () => {
    selectDraftForType(useBillStore.getState(), "itemized", null);
    selectDraftForType(useBillStore.getState(), "itemized", "group-1");
    expect(useBillStore.getState().expense?.groupId).toBe("group-1");
  });
});

