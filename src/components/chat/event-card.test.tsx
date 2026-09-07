import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventCard } from "./event-card";
import type { GroupEvent, Settlement } from "@/types/ledger";

const mutations = vi.hoisted(() => ({
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
    status: "confirmed",
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


  it("shows Confirmado with Desfazer for a settlement still present", async () => {
    const settlement = makeSettlement({ toUserId: meId, fromUserId: otherId });
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

    expect(screen.getByText("Confirmado")).toBeDefined();
    expect(screen.queryByTestId("event-confirm-settlement")).toBeNull();
    expect(screen.queryByTestId("event-reject-settlement")).toBeNull();

    fireEvent.click(screen.getByTestId("event-undo-settlement"));
    await waitFor(() => {
      expect(mutations.voidSettlement).toHaveBeenCalledWith("g1", "set-1");
    });
  });

  it("offers Desfazer to the payer as well", () => {
    const settlement = makeSettlement({ toUserId: otherId, fromUserId: meId });
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

    expect(screen.getByTestId("event-undo-settlement")).toBeDefined();
  });

  it("shows Desfeito without actions once the settlement is gone", () => {
    const event = makeEvent({ kind: "settlement_recorded" });

    render(
      <EventCard
        event={event}
        groupId="g1"
        meId={meId}
        settlement={null}
        latestStatus="voided"
        nameOf={nameOf}
      />,
    );

    expect(screen.getByText("Desfeito")).toBeDefined();
    expect(screen.queryByTestId("event-undo-settlement")).toBeNull();
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
