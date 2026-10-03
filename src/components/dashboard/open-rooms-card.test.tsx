import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as FramerMotion from "framer-motion";
import type { OpenAssignmentRoom } from "@/types/assignment-room";
import type { OpenRoomCardItem } from "./home-selectors";
import { HomeOpenRoomsCard } from "./open-rooms-card";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: { tap: vi.fn(), selectionChanged: vi.fn() },
}));

vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof FramerMotion>()),
  useReducedMotion: () => true,
}));

function item(id: string, overrides: Partial<OpenAssignmentRoom> = {}): OpenRoomCardItem {
  return {
    room: {
      id,
      groupId: "g1",
      status: "open",
      revision: 1,
      title: `Conta ${id}`,
      occurredOn: "2026-09-20",
      totalCents: 12000,
      host: { id: "user-2", handle: "carol", name: "Carol Souza", avatarUrl: null, isBot: false },
      createdAt: "2026-09-20T12:00:00Z",
      itemCount: 4,
      ownedItemCount: 1,
      claimers: [],
      expenseId: null,
      joined: false,
      ...overrides,
    },
    placeLabel: "Jantar",
  };
}

function renderCard(rooms: OpenRoomCardItem[], pendingRoomId: string | null = null) {
  return render(<HomeOpenRoomsCard rooms={rooms} pendingRoomId={pendingRoomId} onOpen={vi.fn()} />);
}

describe("HomeOpenRoomsCard", () => {
  it("renders nothing when there are no rooms", () => {
    const { container } = renderCard([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Entrar on a new room and Continuar on a joined one", () => {
    renderCard([item("room-new"), item("room-joined", { joined: true })]);

    const fresh = screen.getByRole("button", { name: /Conta room-new/ });
    expect(within(fresh).getByText("Nova")).toBeInTheDocument();
    expect(within(fresh).getByText("Entrar")).toBeInTheDocument();

    const joined = screen.getByRole("button", { name: /Conta room-joined/ });
    expect(within(joined).getByText("Continuar")).toBeInTheDocument();
    expect(within(joined).queryByText("Nova")).not.toBeInTheDocument();
  });

  it("disables every row while a room is opening and keeps the opening row busy", async () => {
    const onOpen = vi.fn();
    render(<HomeOpenRoomsCard rooms={[item("room-a"), item("room-b")]} pendingRoomId="room-a" onOpen={onOpen} />);

    const opening = screen.getByRole("button", { name: /Conta room-a/ });
    const other = screen.getByRole("button", { name: /Conta room-b/ });
    expect(opening).toBeDisabled();
    expect(other).toBeDisabled();
    expect(within(opening).getByText("Abrindo…")).toBeInTheDocument();
    expect(within(opening).queryByText("Entrar")).not.toBeInTheDocument();

    await userEvent.click(other);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps only three rows collapsed and expands with Ver todas", async () => {
    renderCard([item("room-1"), item("room-2"), item("room-3"), item("room-4")]);

    expect(screen.queryByRole("button", { name: /Conta room-4/ })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Ver todas (4)" });
    await userEvent.click(toggle);

    expect(screen.getByRole("button", { name: /Conta room-4/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver menos" })).toBeInTheDocument();
  });
});
