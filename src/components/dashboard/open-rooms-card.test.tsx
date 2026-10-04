import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as FramerMotion from "framer-motion";
import type { HostedAssignmentRoom, OpenAssignmentRoom } from "@/types/assignment-room";
import type { HomeRoomCardItem } from "./home-selectors";
import { HomeOpenRoomsCard } from "./open-rooms-card";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: { tap: vi.fn(), selectionChanged: vi.fn() },
}));

vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof FramerMotion>()),
  useReducedMotion: () => true,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & React.ComponentProps<"a">) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const carol = { id: "user-2", handle: "carol", name: "Carol Souza", avatarUrl: null, isBot: false };

function openRoom(id: string, overrides: Partial<OpenAssignmentRoom> = {}): OpenAssignmentRoom {
  return {
    id,
    groupId: "g1",
    status: "open",
    revision: 1,
    title: `Conta ${id}`,
    occurredOn: "2026-09-20",
    totalCents: 12000,
    host: carol,
    createdAt: "2026-09-20T12:00:00Z",
    itemCount: 4,
    ownedItemCount: 1,
    claimers: [],
    expenseId: null,
    joined: false,
    ...overrides,
  };
}

function openItem(id: string, overrides: Partial<OpenAssignmentRoom> = {}): HomeRoomCardItem {
  return { kind: "open", room: openRoom(id, overrides), hostLabel: "Carol", placeLabel: "Jantar" };
}

function hostedRoom(id: string, overrides: Partial<HostedAssignmentRoom> = {}): HostedAssignmentRoom {
  return {
    id,
    groupId: "g1",
    groupName: "Casa da Ana",
    status: "open",
    revision: 1,
    title: `Conta ${id}`,
    occurredOn: "2026-09-20",
    totalCents: 12345,
    host: carol,
    createdAt: "2026-09-21T12:00:00Z",
    itemCount: 4,
    ownedItemCount: 2,
    claimers: [{ participantId: "p1", userId: "user-1", name: "Ana Souza", avatarUrl: null }],
    expenseId: null,
    ...overrides,
  };
}

function hostedItem(id: string, overrides: Partial<HostedAssignmentRoom> = {}, placeLabel = "Casa da Ana"): HomeRoomCardItem {
  return { kind: "hosted", room: hostedRoom(id, overrides), hostLabel: "Você", placeLabel };
}

function renderCard(rooms: HomeRoomCardItem[], pendingRoomId: string | null = null) {
  return render(<HomeOpenRoomsCard rooms={rooms} pendingRoomId={pendingRoomId} onOpen={vi.fn()} />);
}

describe("HomeOpenRoomsCard", () => {
  it("renders nothing when there are no rooms", () => {
    const { container } = renderCard([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("links hosted rows to their room", () => {
    renderCard([hostedItem("grouped"), hostedItem("standalone", { groupId: null, groupName: null })]);

    expect(screen.getByRole("link", { name: /Conta grouped/ })).toHaveAttribute("href", "/room/grouped");
    expect(screen.getByRole("link", { name: /Conta standalone/ })).toHaveAttribute("href", "/room/standalone");
  });

  it("asks to register the bill on closed hosted rooms and keeps claim progress on open ones", () => {
    renderCard([hostedItem("review", { status: "closed" }), hostedItem("claiming")]);

    const review = screen.getByRole("link", { name: /Conta review/ });
    expect(within(review).getByText("Em revisão")).toBeInTheDocument();
    expect(within(review).getByText("Falta registrar a conta")).toBeInTheDocument();
    expect(within(review).queryByText("2/4 itens atribuídos")).not.toBeInTheDocument();

    const claiming = screen.getByRole("link", { name: /Conta claiming/ });
    expect(within(claiming).getByText("2/4 itens atribuídos")).toBeInTheDocument();
    expect(within(claiming).queryByText("Falta registrar a conta")).not.toBeInTheDocument();
  });

  it("marks only unjoined rooms from others as Nova", () => {
    renderCard([openItem("fresh"), openItem("joined-room", { joined: true }), hostedItem("mine")]);

    expect(within(screen.getByRole("button", { name: /Conta fresh/ })).getByText("Nova")).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Conta joined-room/ })).queryByText("Nova"),
    ).not.toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Conta mine/ })).queryByText("Nova")).not.toBeInTheDocument();
  });

  it("opens a room opened by someone else when its row is tapped", async () => {
    const onOpen = vi.fn();
    const room = openRoom("room-a");
    render(
      <HomeOpenRoomsCard
        rooms={[{ kind: "open", room, hostLabel: "Carol", placeLabel: "Jantar" }]}
        pendingRoomId={null}
        onOpen={onOpen}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Conta room-a/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(room);
  });

  it("disables every row while a room is opening and keeps the opening row busy", async () => {
    const onOpen = vi.fn();
    render(<HomeOpenRoomsCard rooms={[openItem("room-a"), openItem("room-b")]} pendingRoomId="room-a" onOpen={onOpen} />);

    const opening = screen.getByRole("button", { name: /Conta room-a/ });
    const other = screen.getByRole("button", { name: /Conta room-b/ });
    expect(opening).toBeDisabled();
    expect(other).toBeDisabled();
    expect(within(opening).getByLabelText("Abrindo sala")).toBeInTheDocument();

    await userEvent.click(other);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows claimed item progress as N/M itens atribuídos", () => {
    renderCard([openItem("room-progress", { ownedItemCount: 1, itemCount: 4 })]);
    expect(screen.getByText("1/4 itens atribuídos")).toBeInTheDocument();
  });

  it("uses the singular when a room has a single item", () => {
    renderCard([openItem("room-single", { ownedItemCount: 1, itemCount: 1 })]);
    expect(screen.getByText("1/1 item atribuído")).toBeInTheDocument();
  });

  it("keeps only three rows collapsed and expands without losing navigation", async () => {
    renderCard([openItem("room-1"), openItem("room-2"), hostedItem("room-3"), hostedItem("room-4")]);

    expect(screen.getByRole("region", { name: "Suas salas" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Conta room-4/ })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Ver todas (4)" });
    await userEvent.click(toggle);

    expect(screen.getByRole("link", { name: /Conta room-4/ })).toHaveAttribute("href", "/room/room-4");
    expect(screen.getByRole("button", { name: "Ver menos" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ver menos" }));
    expect(screen.queryByRole("link", { name: /Conta room-4/ })).not.toBeInTheDocument();
  });
});
