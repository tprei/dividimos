import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventCard } from "./event-card";
import type { GroupEvent, Settlement } from "@/types/ledger";

const mutations = vi.hoisted(() => ({
  confirmSettlement: vi.fn().mockResolvedValue({ eventId: 1 }),
  voidSettlement: vi.fn().mockResolvedValue({ eventId: 2 }),
}));
vi.mock("@/lib/sync/mutations", () => mutations);

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid="link">
      {children}
    </a>
  ),
}));

const meId = "user-me";
const otherId = "user-other";

function makeSettlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: "set-1",
    operationId: "op-1",
    groupId: "g1",
    fromUserId: otherId,
    toUserId: meId,
    amountCents: 5000,
    status: "pending",
    createdBy: otherId,
    createdAt: "2026-01-01T10:00:00Z",
    confirmedAt: null,
    voidedAt: null,
    voidedBy: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<GroupEvent> = {}): GroupEvent {
  return {
    id: 1,
    groupId: "g1",
    actorId: otherId,
    kind: "settlement_recorded",
    expenseId: null,
    settlementId: "set-1",
    subjectUserId: null,
    payload: { amountCents: 5000, toUserId: meId, fromUserId: otherId },
    createdAt: "2026-01-01T10:00:00Z",
    actor: { id: otherId, handle: "bob", name: "Bob Silva", avatarUrl: null },
    expenseTitle: null,
    ...overrides,
  };
}

const nameOf = (id: string) => (id === meId ? "Você" : "Bob Silva");

describe("EventCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Confirmar and Recusar for pending settlement when viewer is payee and calls mutations", async () => {
    const settlement = makeSettlement({ toUserId: meId, fromUserId: otherId, status: "pending" });
    const event = makeEvent({ kind: "settlement_recorded", settlementId: settlement.id });

    render(
      <EventCard
        event={event}
        groupId="g1"
        meId={meId}
        settlement={settlement}
        latestStatus={null}
        nameOf={nameOf}
      />,
    );

    const confirmBtn = screen.getByTestId("event-confirm-settlement");
    const rejectBtn = screen.getByTestId("event-reject-settlement");
    expect(confirmBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(mutations.confirmSettlement).toHaveBeenCalledWith("g1", "set-1");
    });

    fireEvent.click(rejectBtn);
    await waitFor(() => {
      expect(mutations.voidSettlement).toHaveBeenCalledWith("g1", "set-1", false);
    });
  });

  it("links expense cards to the expense", () => {
    const event = makeEvent({
      id: 2,
      kind: "expense_created",
      expenseId: "exp-42",
      expenseTitle: "Almoço",
      settlementId: null,
      payload: { totalCents: 3500 },
    });

    render(
      <EventCard
        event={event}
        groupId="g1"
        meId={meId}
        settlement={null}
        latestStatus={null}
        nameOf={nameOf}
      />,
    );

    const link = screen.getByTestId("link");
    expect(link.getAttribute("href")).toBe("/app/bill/exp-42");
    expect(screen.getByText("Almoço")).toBeDefined();
    expect(screen.getByText("R$ 35,00")).toBeDefined();
  });

  it("renders the sentence for membership kinds without a card", () => {
    const event = makeEvent({
      id: 3,
      kind: "member_joined",
      actorId: otherId,
      subjectUserId: otherId,
      settlementId: null,
      expenseId: null,
      payload: {},
    });

    render(
      <EventCard
        event={event}
        groupId="g1"
        meId={meId}
        settlement={null}
        latestStatus={null}
        nameOf={nameOf}
      />,
    );

    expect(screen.getByTestId("event-sentence")).toBeDefined();
    expect(screen.getByText("Bob Silva entrou no grupo")).toBeDefined();
    expect(screen.queryByTestId("event-settlement-card")).toBeNull();
    expect(screen.queryByTestId("event-expense-card")).toBeNull();
  });
});
