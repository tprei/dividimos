import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenRoomsCard } from "./open-rooms-card";
import type * as FramerMotion from "framer-motion";
import type { OpenAssignmentRoom } from "@/types/assignment-room";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof FramerMotion>()),
  useReducedMotion: () => true,
}));

const viewerId = "u1";

function hostFixture(id: string) {
  return { id, handle: `h${id}`, name: `Ana Souza ${id}`, avatarUrl: null, isBot: false };
}

function room(id: string, overrides: Partial<OpenAssignmentRoom> = {}): OpenAssignmentRoom {
  return {
    id,
    groupId: "g1",
    status: "open",
    revision: 1,
    title: `Conta ${id}`,
    occurredOn: "2026-09-20",
    totalCents: 12345,
    host: hostFixture("u2"),
    createdAt: "2026-09-21T12:00:00Z",
    itemCount: 2,
    ownedItemCount: 0,
    claimers: [],
    expenseId: null,
    joined: false,
    ...overrides,
  };
}

function renderCard(
  rooms: OpenAssignmentRoom[],
  pendingRoomId: string | null = null,
  onOpenRoom = vi.fn(),
) {
  return render(
    <OpenRoomsCard
      rooms={rooms}
      viewerId={viewerId}
      pendingRoomId={pendingRoomId}
      onOpenRoom={onOpenRoom}
    />,
  );
}

describe("OpenRoomsCard", () => {
  it("renders nothing when there are no open rooms", () => {
    const { container } = renderCard([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onOpenRoom with the clicked room", async () => {
    const onOpenRoom = vi.fn();
    const pizza = room("r1");
    renderCard([pizza, room("r2")], null, onOpenRoom);

    await userEvent.click(screen.getByRole("button", { name: /Conta r1/ }));
    expect(onOpenRoom).toHaveBeenCalledTimes(1);
    expect(onOpenRoom).toHaveBeenCalledWith(pizza);
  });

  it("shows the marking CTA only for rooms the viewer has not joined", () => {
    const hostedByViewer = room("r3", { host: hostFixture(viewerId) });
    renderCard([room("r1"), room("r2", { joined: true }), hostedByViewer]);

    expect(screen.getAllByText("Marcar meus itens")).toHaveLength(1);
    expect(screen.getAllByText("Ver conta")).toHaveLength(2);
  });

  it("labels the viewer as the host of their own room", () => {
    renderCard([room("r1", { host: hostFixture(viewerId) })]);
    expect(screen.getByText(/Você ·/)).toBeInTheDocument();
  });

  it("disables every row while one is pending, with the busy label only on the pending row", async () => {
    const onOpenRoom = vi.fn();
    renderCard([room("r1"), room("r2")], "r1", onOpenRoom);

    const pendingRow = screen.getByRole("button", { name: /Conta r1/ });
    expect(pendingRow).toBeDisabled();
    expect(pendingRow.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.getByText("Abrindo…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Conta r2/ })).toBeDisabled();
    expect(screen.getAllByText("Marcar meus itens")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /Conta r2/ }));
    expect(onOpenRoom).not.toHaveBeenCalled();
  });

  it("collapses long lists and expands on request", async () => {
    renderCard([room("r1"), room("r2"), room("r3"), room("r4"), room("r5")]);

    expect(screen.getByText("Conta r3")).toBeInTheDocument();
    expect(screen.queryByText("Conta r4")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Ver todas (5)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Ver menos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Conta r5")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ver menos" }));
    expect(screen.queryByText("Conta r4")).not.toBeInTheDocument();
    expect(screen.getByText("Conta r2")).toBeInTheDocument();
  });
});
