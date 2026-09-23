import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoomActivity } from "./room-activity";
import type {
  AssignmentRoomActivity,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
} from "@/types/assignment-room";

const participants: AssignmentRoomParticipant[] = [
  { id: "a", ordinal: 0, displayName: "Ana", avatarUrl: null, isGuest: false, removed: false },
  { id: "b", ordinal: 1, displayName: "Bia", avatarUrl: null, isGuest: true, removed: false },
  { id: "c", ordinal: 2, displayName: "Caio", avatarUrl: null, isGuest: true, removed: false },
];
const items: AssignmentRoomItem[] = [
  {
    id: "item-1",
    ordinal: 0,
    revision: 2,
    description: "Batata",
    quantityMilliunits: 1_000,
    unitPriceCents: 100,
    totalPriceCents: 100,
  },
];

function activity(value: AssignmentRoomActivity): ReactElement {
  return (
    <RoomActivity
      activity={value}
      participants={participants}
      items={items}
      connected={false}
    />
  );
}

describe("RoomActivity", () => {
  it("distinguishes additions, reductions, undo, and multi-person changes in the guest ticker", () => {
    const change = { itemId: "item-1", participantId: "a", beforeTicks: 0, afterTicks: 60_000 };
    const show = (changes: typeof change[]) => (
      <RoomActivity variant="ticker" activity={{ kind: "claims", changes, revision: 2, observedAt: 1 }} participants={participants} items={items} connected />
    );
    const { container, rerender } = render(show([change]));
    expect(container).toHaveTextContent("Ana pegou Batata · metade");
    expect(screen.queryByLabelText("Conectado")).not.toBeInTheDocument();
    rerender(show([{ ...change, beforeTicks: 120_000 }]));
    expect(container).toHaveTextContent("Ana mudou Batata · metade");
    rerender(show([{ ...change, beforeTicks: 60_000, afterTicks: 0 }]));
    expect(container).toHaveTextContent("Ana desfez Batata");
    expect(container).not.toHaveTextContent("metade");
    rerender(show([change, { ...change, participantId: "b" }]));
    expect(container).toHaveTextContent("2 escolhas mudaram");
  });

  it("summarizes one, two, and larger join bursts", () => {
    const { rerender } = render(
      activity({ kind: "joined", participantIds: ["a"], burstStartedAt: 1, revision: 2, observedAt: 1 }),
    );
    expect(screen.getByText("Ana entrou")).toBeInTheDocument();

    rerender(
      activity({ kind: "joined", participantIds: ["a", "b"], burstStartedAt: 1, revision: 3, observedAt: 2 }),
    );
    expect(screen.getByText("Ana e Bia entraram")).toBeInTheDocument();

    rerender(
      activity({ kind: "joined", participantIds: ["a", "b", "c"], burstStartedAt: 1, revision: 4, observedAt: 3 }),
    );
    expect(screen.getByText("Ana, Bia e mais 1 entraram")).toBeInTheDocument();
  });

  it("names claim, removal, and lifecycle changes", () => {
    const { rerender } = render(
      activity({
        kind: "claims",
        changes: [{ itemId: "item-1", participantId: "b", beforeTicks: 0, afterTicks: 120 }],
        revision: 2,
        observedAt: 1,
      }),
    );
    expect(screen.getByText("Escolha de Bia em Batata atualizada")).toBeInTheDocument();

    rerender(activity({ kind: "removed", participantIds: ["b"], revision: 3, observedAt: 2 }));
    expect(screen.getByText("Bia não está mais na sala")).toBeInTheDocument();

    rerender(activity({ kind: "status", status: "closed", revision: 4, observedAt: 3 }));
    expect(screen.getByText("Escolhas encerradas")).toBeInTheDocument();
  });

  it("announces activity politely and omits the connection dot offline", () => {
    render(
      <RoomActivity
        activity={{ kind: "updated", revision: 2, observedAt: 1 }}
        participants={participants}
        items={items}
        connected={false}
      />,
    );
    expect(screen.getByText("Sala atualizada")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByLabelText("Conectado")).not.toBeInTheDocument();
  });
});
