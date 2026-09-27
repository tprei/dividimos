import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoomOpenedCard } from "./room-opened-card";
import type { AssignmentRoomSummary } from "@/types/assignment-room";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: { tap: vi.fn(), impact: vi.fn(), success: vi.fn(), error: vi.fn(), selectionChanged: vi.fn() },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const viewerId = "me";

function summary(overrides: Partial<AssignmentRoomSummary> = {}): AssignmentRoomSummary {
  return {
    id: "room-1",
    groupId: "g1",
    status: "open",
    revision: 3,
    title: "Bar do Zé",
    occurredOn: "2026-09-19",
    totalCents: 18260,
    host: { id: "host-1", handle: "ana", name: "Ana Souza", avatarUrl: null, isBot: false },
    createdAt: "2026-09-21T14:32:00Z",
    itemCount: 3,
    ownedItemCount: 1,
    claimers: [{ participantId: "p1", userId: "host-1", name: "Ana Souza", avatarUrl: null }],
    expenseId: null,
    ...overrides,
  };
}

function renderCard(props: Partial<Parameters<typeof RoomOpenedCard>[0]> = {}) {
  const allProps = {
    summary: summary(),
    actorName: "Ana Souza",
    at: "2026-09-21T14:32:00Z",
    viewerId,
    joined: false,
    removed: false,
    pending: false,
    disabled: false,
    onOpenRoom: vi.fn(),
    ...props,
  };
  render(<RoomOpenedCard {...allProps} />);
  return allProps;
}

describe("RoomOpenedCard", () => {
  it("offers the marking CTA to someone outside the room and reports progress", async () => {
    const props = renderCard();

    expect(screen.getByRole("button", { name: "Marcar meus itens" })).toBeInTheDocument();
    expect(screen.getByText("1 de 3 itens com dono")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Marcaram itens: Ana Souza");

    await userEvent.click(screen.getByRole("button", { name: "Marcar meus itens" }));
    expect(props.onOpenRoom).toHaveBeenCalledTimes(1);
  });

  it("offers no action to a viewer the host removed from an open or closed room", () => {
    renderCard({ removed: true });
    expect(screen.getByText("Você foi removido dessa conta")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("downgrades to Ver conta once the viewer joined or hosts the room", async () => {
    const joined = renderCard({ joined: true });
    expect(screen.getByRole("button", { name: "Ver conta" })).toBeInTheDocument();
    expect(screen.queryByText("Marcar meus itens")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver conta" }));
    expect(joined.onOpenRoom).toHaveBeenCalledTimes(1);
  });

  it("shows Ver conta to the host even without a join record", () => {
    renderCard({ summary: summary({ host: { id: viewerId, handle: "me", name: "Você", avatarUrl: null, isBot: false } }) });

    expect(screen.getByRole("button", { name: "Ver conta" })).toBeInTheDocument();
  });

  it("keeps the CTA busy and inert while the room opens", async () => {
    const props = renderCard({ pending: true });

    const action = screen.getByRole("button", { name: /Abrindo…/ });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Marcar meus itens")).not.toBeInTheDocument();

    await userEvent.click(action);
    expect(props.onOpenRoom).not.toHaveBeenCalled();
  });

  it("disables the CTA without faking progress", () => {
    renderCard({ disabled: true });

    const action = screen.getByRole("button", { name: "Marcar meus itens" });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("aria-busy", "false");
  });

  it("keeps closed rooms in review, opening them only for participants", async () => {
    const closed = summary({ status: "closed" });
    const participant = renderCard({ summary: closed, joined: true });

    expect(screen.getByText("Em revisão")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver conta" }));
    expect(participant.onOpenRoom).toHaveBeenCalledTimes(1);
  });

  it("leaves outsiders with no action on a closed room", () => {
    renderCard({ summary: summary({ status: "closed" }) });

    expect(screen.getByText("Em revisão")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("links finalized rooms to the registered expense", () => {
    renderCard({ summary: summary({ status: "finalized", expenseId: "exp-9" }) });

    expect(screen.getByText("Conta registrada")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Ver conta" });
    expect(link).toHaveAttribute("href", "/app/bill/exp-9");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("survives a finalized room without an expense", () => {
    renderCard({ summary: summary({ status: "finalized", expenseId: null }) });

    expect(screen.getByText("Conta registrada")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("mutes cancelled rooms and drops the progress line", () => {
    renderCard({ summary: summary({ status: "cancelled" }) });

    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.getByText("Bar do Zé")).toBeInTheDocument();
    expect(screen.queryByText(/com dono/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
