import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventCard } from "./event-card";
import {
  readConfirmationPreferences,
  updateConfirmationPreferences,
} from "@/lib/confirmation-preferences";
import type { GroupEvent, Settlement } from "@/types/ledger";

const mutations = vi.hoisted(() => ({
  voidSettlement: vi.fn().mockResolvedValue({ eventId: 2 }),
}));
vi.mock("@/lib/sync/mutations", () => mutations);

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({ default: toastMocks }));

vi.mock("@/lib/sync/refresh", () => ({
  refreshSettlement: vi.fn().mockResolvedValue(undefined),
}));

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
    actor: { id: otherId, handle: "bob", name: "Bob Silva", avatarUrl: null, isBot: false },
    expenseTitle: null,
    ...overrides,
  };
}

const nameOf = (id: string) => (id === meId ? "Você" : "Bob Silva");

describe("EventCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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

    fireEvent.click(screen.getByRole("button", { name: "Desfazer registro" }));
    await waitFor(() => {
      expect(mutations.voidSettlement).toHaveBeenCalledWith("g1", "set-1");
    });
    expect(toastMocks.success).toHaveBeenCalledWith("Pagamento desfeito");
  });

  it("voids without the dialog once the viewer opted out of confirmations", async () => {
    updateConfirmationPreferences(meId, { confirmVoidSettlement: false });
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

    fireEvent.click(screen.getByTestId("event-undo-settlement"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mutations.voidSettlement).toHaveBeenCalledWith("g1", "set-1");
    });
  });

  it("remembers the do-not-ask choice made inside the dialog", async () => {
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

    fireEvent.click(screen.getByTestId("event-undo-settlement"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Não perguntar de novo" }));
    fireEvent.click(screen.getByRole("button", { name: "Desfazer registro" }));

    await waitFor(() => {
      expect(mutations.voidSettlement).toHaveBeenCalledWith("g1", "set-1");
    });
    expect(readConfirmationPreferences(meId).confirmVoidSettlement).toBe(false);
  });

  it("opens confirmation dialog when Desfazer is clicked without invoking voidSettlement", async () => {
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

    fireEvent.click(screen.getByTestId("event-undo-settlement"));

    expect(screen.getByText(/Desfazer este registro\?/)).toBeInTheDocument();
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Bob Silva")).toBeInTheDocument();
    expect(dialog.getByText("Você")).toBeInTheDocument();
    expect(
      screen.getByText(/O registro fica marcado como Desfeito e os saldos são recalculados na hora\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/O Pix em si não é estornado\. Combina a devolução direto com a outra pessoa\./),
    ).toBeInTheDocument();
    expect(mutations.voidSettlement).not.toHaveBeenCalled();
  });

  it("closes dialog without calling voidSettlement when Cancelar is clicked", async () => {
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

    fireEvent.click(screen.getByTestId("event-undo-settlement"));
    expect(screen.getByText(/Desfazer este registro\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.queryByText(/Desfazer este registro\?/)).not.toBeInTheDocument();
    });
    expect(mutations.voidSettlement).not.toHaveBeenCalled();
  });

  it("calls voidSettlement when Desfazer registro is confirmed and handles error gracefully", async () => {
    mutations.voidSettlement.mockRejectedValueOnce(new Error("Falha na rede"));
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

    fireEvent.click(screen.getByTestId("event-undo-settlement"));
    fireEvent.click(screen.getByRole("button", { name: "Desfazer registro" }));

    await waitFor(() => {
      expect(mutations.voidSettlement).toHaveBeenCalledWith("g1", "set-1");
    });
    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: "Desfazer registro" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).not.toBeDisabled();
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

  it("offers Ver pagamento to a third member who cannot undo", () => {
    const thirdId = "user-third";
    const settlementBetweenOthers = makeSettlement({
      fromUserId: otherId,
      toUserId: thirdId,
    });
    const event = makeEvent({
      kind: "settlement_recorded",
      settlementId: settlementBetweenOthers.id,
      payload: { amountCents: 5000, fromUserId: otherId, toUserId: thirdId },
    });

    render(
      <EventCard event={event} groupId="g1" meId={meId} settlement={settlementBetweenOthers} latestStatus={null} nameOf={nameOf} />,
    );

    expect(screen.getByTestId("event-view-settlement")).toBeInTheDocument();
    expect(screen.queryByTestId("event-undo-settlement")).not.toBeInTheDocument();
  });

  it("opens the shared sheet and keeps the event summary while the detail loads", async () => {
    const { refreshSettlement } = await import("@/lib/sync/refresh");
    const settlementBetweenOthers = makeSettlement({
      fromUserId: otherId,
      toUserId: "user-third",
    });
    const event = makeEvent({
      kind: "settlement_recorded",
      settlementId: settlementBetweenOthers.id,
    });

    render(
      <EventCard event={event} groupId="g1" meId={meId} settlement={settlementBetweenOthers} latestStatus={null} nameOf={nameOf} />,
    );

    fireEvent.click(screen.getByTestId("event-view-settlement"));

    await waitFor(() => {
      expect(refreshSettlement).toHaveBeenCalledWith("set-1");
    });
    expect(screen.getByTestId("settlement-detail-popover")).toBeInTheDocument();
    expect(screen.getByTestId("event-settlement-card")).toHaveTextContent("R$ 50,00");
    expect(screen.getByTestId("settlement-detail-loading")).toBeInTheDocument();
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
