import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as FramerMotion from "framer-motion";
import type { HostedAssignmentRoom } from "@/types/assignment-room";
import { HostedRoomsCard } from "./hosted-rooms-card";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: { selectionChanged: vi.fn() },
}));

vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof FramerMotion>()),
  useReducedMotion: () => true,
}));

function room(id: string, overrides: Partial<HostedAssignmentRoom> = {}): HostedAssignmentRoom {
  return {
    id,
    groupId: "g1",
    groupName: "Casa da Ana",
    status: "open",
    revision: 1,
    title: `Conta ${id}`,
    occurredOn: "2026-09-20",
    totalCents: 12345,
    host: { id: "u1", handle: "ana", name: "Ana Souza", avatarUrl: null, isBot: false },
    createdAt: "2026-09-21T12:00:00Z",
    itemCount: 4,
    ownedItemCount: 2,
    claimers: [{ participantId: "p1", userId: "u1", name: "Ana Souza", avatarUrl: null }],
    expenseId: null,
    ...overrides,
  };
}

describe("HostedRoomsCard", () => {
  it("renders nothing when there are no hosted rooms", () => {
    const { container } = render(<HostedRoomsCard rooms={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("identifies grouped and standalone rooms and links each to its room", () => {
    render(<HostedRoomsCard rooms={[
      room("grouped"),
      room("standalone", { groupId: null, groupName: null }),
    ]} />);

    const grouped = screen.getByRole("link", { name: /Conta grouped/ });
    const standalone = screen.getByRole("link", { name: /Conta standalone/ });
    expect(grouped).toHaveAttribute("href", "/room/grouped");
    expect(standalone).toHaveAttribute("href", "/room/standalone");
    expect(within(grouped).getByText("Casa da Ana")).toBeInTheDocument();
    expect(within(standalone).getByText("Sem grupo")).toBeInTheDocument();
  });

  it("distinguishes a review task from a room still accepting claims", () => {
    render(<HostedRoomsCard rooms={[room("open"), room("review", { status: "closed" })]} />);

    const review = screen.getByRole("link", { name: /Conta review/ });
    const open = screen.getByRole("link", { name: /Conta open/ });
    expect(within(review).getByText("Em revisão")).toBeInTheDocument();
    expect(within(review).getByText("Falta registrar a conta")).toBeInTheDocument();
    expect(within(open).queryByText("Falta registrar a conta")).not.toBeInTheDocument();
  });

  it("exposes claimed item progress and the people who claimed them", () => {
    render(<HostedRoomsCard rooms={[room("pizza")]} />);

    const progress = screen.getByRole("progressbar", { name: /Conta pizza/ });
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuenow", "2");
    expect(progress).toHaveAttribute("aria-valuemax", "4");
    expect(progress).toHaveAttribute("aria-valuetext", "2 de 4 itens com dono");
    expect(screen.getByRole("img", { name: /Marcaram itens: Ana Souza/ })).toBeInTheDocument();
  });

  it("keeps a room without items at zero progress with an explicit accessible value", () => {
    render(<HostedRoomsCard rooms={[room("empty", { itemCount: 0, ownedItemCount: 0, claimers: [] })]} />);

    const progress = screen.getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    expect(progress).toHaveAttribute("aria-valuetext", "0 de 0 itens com dono");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("expands and collapses older rooms without losing their navigation", async () => {
    render(<HostedRoomsCard rooms={[room("1"), room("2"), room("3"), room("4")]} />);

    expect(screen.queryByRole("link", { name: /Conta 4/ })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { expanded: false });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Conta 4/ })).toHaveAttribute("href", "/room/4");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /Conta 4/ })).not.toBeInTheDocument();
  });
});
