import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityContent } from "./activity-content";
import type {
  ActivityItem,
  ExpenseActivatedActivity,
  SettlementRecordedActivity,
  SettlementConfirmedActivity,
  MemberJoinedActivity,
  UserProfile,
} from "@/types";

vi.mock("@/lib/supabase/activity-actions", () => ({
  fetchActivityFeed: vi.fn().mockResolvedValue([]),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const actor: UserProfile = {
  id: "user-a",
  handle: "alice",
  name: "Alice",
  avatarUrl: undefined,
};

const otherUser: UserProfile = {
  id: "user-b",
  handle: "bob",
  name: "Bob",
  avatarUrl: undefined,
};

function makeExpenseActivity(
  overrides?: Partial<ExpenseActivatedActivity>,
): ExpenseActivatedActivity {
  return {
    id: "expense-1",
    type: "expense_activated",
    groupId: "group-1",
    groupName: "Amigos",
    actorId: actor.id,
    actor,
    timestamp: "2026-04-09T10:00:00Z",
    expenseId: "exp-1",
    expenseTitle: "Almoço",
    totalAmount: 5000,
    ...overrides,
  };
}

function makeSettlementRecorded(
  overrides?: Partial<SettlementRecordedActivity>,
): SettlementRecordedActivity {
  return {
    id: "settlement-rec-1",
    type: "settlement_recorded",
    groupId: "group-1",
    groupName: "Amigos",
    actorId: actor.id,
    actor,
    timestamp: "2026-04-09T11:00:00Z",
    settlementId: "sett-1",
    toUserId: otherUser.id,
    toUser: otherUser,
    amountCents: 2500,
    ...overrides,
  };
}

function makeSettlementConfirmed(
  overrides?: Partial<SettlementConfirmedActivity>,
): SettlementConfirmedActivity {
  return {
    id: "settlement-conf-1",
    type: "settlement_confirmed",
    groupId: "group-1",
    groupName: "Amigos",
    actorId: otherUser.id,
    actor: otherUser,
    timestamp: "2026-04-09T12:00:00Z",
    settlementId: "sett-1",
    fromUserId: actor.id,
    fromUser: actor,
    amountCents: 2500,
    ...overrides,
  };
}

function makeMemberJoined(
  overrides?: Partial<MemberJoinedActivity>,
): MemberJoinedActivity {
  return {
    id: "member-group1-userb",
    type: "member_joined",
    groupId: "group-1",
    groupName: "Amigos",
    actorId: otherUser.id,
    actor: otherUser,
    timestamp: "2026-04-09T09:00:00Z",
    ...overrides,
  };
}

describe("ActivityContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders page title", () => {
    render(<ActivityContent initialItems={[]} userId="user-a" />);
    expect(screen.getByText("Atividade")).toBeInTheDocument();
  });

  it("shows empty state when no items", () => {
    render(<ActivityContent initialItems={[]} userId="user-a" />);
    expect(screen.getByText("Nenhuma atividade")).toBeInTheDocument();
  });

  it("renders expense activity with correct description for current user", () => {
    const items: ActivityItem[] = [makeExpenseActivity()];
    render(<ActivityContent initialItems={items} userId="user-a" />);
    expect(
      screen.getByText(/Você criou "Almoço" · R\$ 50,00/),
    ).toBeInTheDocument();
  });

  it("renders expense activity with actor name for other user", () => {
    const items: ActivityItem[] = [
      makeExpenseActivity({ actorId: "user-b", actor: otherUser }),
    ];
    render(<ActivityContent initialItems={items} userId="user-a" />);
    expect(
      screen.getByText(/Bob criou "Almoço" · R\$ 50,00/),
    ).toBeInTheDocument();
  });

  it("renders settlement recorded for current user", () => {
    const items: ActivityItem[] = [makeSettlementRecorded()];
    render(<ActivityContent initialItems={items} userId="user-a" />);
    expect(
      screen.getByText(/Você registrou pagamento de R\$ 25,00 para Bob/),
    ).toBeInTheDocument();
  });

  it("renders settlement confirmed for current user", () => {
    const items: ActivityItem[] = [
      makeSettlementConfirmed({
        actorId: "user-a",
        actor,
        fromUserId: otherUser.id,
        fromUser: otherUser,
      }),
    ];
    render(<ActivityContent initialItems={items} userId="user-a" />);
    expect(
      screen.getByText(/Você confirmou pagamento de R\$ 25,00 de Bob/),
    ).toBeInTheDocument();
  });

  it("renders member joined activity", () => {
    const items: ActivityItem[] = [makeMemberJoined()];
    render(<ActivityContent initialItems={items} userId="user-a" />);
    expect(
      screen.getByText(/Bob entrou no grupo/),
    ).toBeInTheDocument();
  });

  it("displays group name badge for each item", () => {
    const items: ActivityItem[] = [makeExpenseActivity()];
    render(<ActivityContent initialItems={items} userId="user-a" />);
    expect(screen.getByText("Amigos")).toBeInTheDocument();
  });

  it("filters to show only expenses", async () => {
    const user = userEvent.setup();
    const items: ActivityItem[] = [
      makeExpenseActivity(),
      makeMemberJoined(),
    ];
    render(<ActivityContent initialItems={items} userId="user-a" />);

    await user.click(screen.getByText("Despesas"));

    expect(screen.getByText(/Almoço/)).toBeInTheDocument();
    expect(screen.queryByText(/entrou no grupo/)).not.toBeInTheDocument();
  });

  it("filters settlements include both recorded and confirmed", async () => {
    const user = userEvent.setup();
    const items: ActivityItem[] = [
      makeSettlementRecorded(),
      makeSettlementConfirmed(),
      makeExpenseActivity(),
    ];
    render(<ActivityContent initialItems={items} userId="user-a" />);

    await user.click(screen.getByText("Pagamentos"));

    expect(screen.getByText(/registrou pagamento/)).toBeInTheDocument();
    expect(screen.getByText(/confirmou pagamento/)).toBeInTheDocument();
    expect(screen.queryByText(/Almoço/)).not.toBeInTheDocument();
  });

  it("filters to show only member joins", async () => {
    const user = userEvent.setup();
    const items: ActivityItem[] = [
      makeExpenseActivity(),
      makeMemberJoined(),
    ];
    render(<ActivityContent initialItems={items} userId="user-a" />);

    await user.click(screen.getByText("Membros"));

    expect(screen.getByText(/entrou no grupo/)).toBeInTheDocument();
    expect(screen.queryByText(/Almoço/)).not.toBeInTheDocument();
  });

  it("shows all items when 'Tudo' filter is selected", async () => {
    const user = userEvent.setup();
    const items: ActivityItem[] = [
      makeExpenseActivity(),
      makeMemberJoined(),
    ];
    render(<ActivityContent initialItems={items} userId="user-a" />);

    await user.click(screen.getByText("Membros"));
    await user.click(screen.getByText("Tudo"));

    expect(screen.getByText(/Almoço/)).toBeInTheDocument();
    expect(screen.getByText(/entrou no grupo/)).toBeInTheDocument();
  });

  it("shows 'Carregar mais' button when 30+ items", () => {
    const items: ActivityItem[] = Array.from({ length: 30 }, (_, i) =>
      makeExpenseActivity({
        id: `expense-${i}`,
        expenseId: `exp-${i}`,
        timestamp: `2026-04-0${(i % 9) + 1}T10:00:00Z`,
      }),
    );
    render(<ActivityContent initialItems={items} userId="user-a" />);
    expect(screen.getByText("Carregar mais")).toBeInTheDocument();
  });

  it("hides 'Carregar mais' when fewer than 30 items", () => {
    const items: ActivityItem[] = [makeExpenseActivity()];
    render(<ActivityContent initialItems={items} userId="user-a" />);
    expect(screen.queryByText("Carregar mais")).not.toBeInTheDocument();
  });
});
