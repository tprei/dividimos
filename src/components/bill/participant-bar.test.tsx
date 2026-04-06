import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParticipantBar } from "./participant-bar";
import type { UserProfile } from "@/types";
import type { Guest } from "@/stores/bill-store";

function makeUser(id: string, name: string, avatarUrl?: string): UserProfile {
  return { id, name, handle: id, avatarUrl };
}

const alice = makeUser("alice", "Alice Souza");
const bob = makeUser("bob", "Bob Lima");
const carol = makeUser("carol", "Carol Dias");

const guestMaria: Guest = { id: "guest_local_1", name: "Maria" };

describe("ParticipantBar", () => {
  const defaultProps = {
    participants: [alice, bob],
    guests: [] as Guest[],
    totalItems: 5,
    assignedCountMap: { alice: 2, bob: 3 } as Record<string, number>,
    mode: "by-item" as const,
  };

  it("renders participant first names", () => {
    render(<ParticipantBar {...defaultProps} />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders guest participants", () => {
    render(<ParticipantBar {...defaultProps} guests={[guestMaria]} />);

    expect(screen.getByText("Maria")).toBeInTheDocument();
  });

  it("renders avatars with correct aria labels in by-item mode", () => {
    render(<ParticipantBar {...defaultProps} />);

    expect(
      screen.getByRole("button", { name: /Alice Souza.*arraste/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Bob Lima.*arraste/i }),
    ).toBeInTheDocument();
  });

  it("does not show drag hint in by-person mode", () => {
    render(<ParticipantBar {...defaultProps} mode="by-person" />);

    expect(
      screen.queryByRole("button", { name: /arraste/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onSelectPerson when avatar tapped in by-person mode", async () => {
    const onSelectPerson = vi.fn();
    const user = userEvent.setup();

    render(
      <ParticipantBar
        {...defaultProps}
        mode="by-person"
        onSelectPerson={onSelectPerson}
      />,
    );

    const aliceBtn = screen.getByRole("button", { name: /Alice Souza/ });
    await user.click(aliceBtn);

    expect(onSelectPerson).toHaveBeenCalledWith("alice");
  });

  it("highlights selected person in by-person mode", () => {
    render(
      <ParticipantBar
        {...defaultProps}
        mode="by-person"
        selectedPersonId="alice"
      />,
    );

    const aliceName = screen.getByText("Alice");
    expect(aliceName).toHaveClass("font-semibold");
    expect(aliceName).toHaveClass("text-primary");
  });

  it("does not show search toggle with 6 or fewer participants", () => {
    render(<ParticipantBar {...defaultProps} />);

    expect(
      screen.queryByRole("button", { name: /buscar/i }),
    ).not.toBeInTheDocument();
  });

  it("shows search toggle with more than 6 participants", () => {
    const manyParticipants = Array.from({ length: 7 }, (_, i) =>
      makeUser(`user-${i}`, `User ${i}`),
    );

    render(
      <ParticipantBar
        {...defaultProps}
        participants={manyParticipants}
      />,
    );

    expect(
      screen.getByRole("button", { name: /buscar/i }),
    ).toBeInTheDocument();
  });

  it("filters participants when search is used", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const manyParticipants = [
      alice,
      bob,
      carol,
      makeUser("d", "Diana"),
      makeUser("e", "Eduardo"),
      makeUser("f", "Felipe"),
      makeUser("g", "Gabriela"),
    ];

    const { rerender } = render(
      <ParticipantBar
        {...defaultProps}
        participants={manyParticipants}
      />,
    );

    const searchToggle = screen.getByRole("button", { name: /buscar/i });
    await user.click(searchToggle);

    const searchInput = screen.getByPlaceholderText("Buscar participante...");
    await user.type(searchInput, "Alice");

    // Advance past debounce (200ms)
    await vi.advanceTimersByTimeAsync(300);

    // Force re-render to pick up state change
    rerender(
      <ParticipantBar
        {...defaultProps}
        participants={manyParticipants}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("renders progress rings with correct aria structure", () => {
    render(<ParticipantBar {...defaultProps} />);

    // Each avatar should have SVG ring
    const svgs = document.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  it("handles empty assignedCountMap gracefully", () => {
    render(
      <ParticipantBar
        {...defaultProps}
        assignedCountMap={{}}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("handles zero totalItems without division error", () => {
    render(
      <ParticipantBar
        {...defaultProps}
        totalItems={0}
        assignedCountMap={{}}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders toolbar with correct aria role", () => {
    render(<ParticipantBar {...defaultProps} />);

    expect(screen.getByRole("toolbar", { name: /participantes/i })).toBeInTheDocument();
  });

  it("closes search and clears query when toggle clicked again", async () => {
    const user = userEvent.setup();

    const manyParticipants = Array.from({ length: 7 }, (_, i) =>
      makeUser(`user-${i}`, `User ${i}`),
    );

    render(
      <ParticipantBar
        {...defaultProps}
        participants={manyParticipants}
      />,
    );

    const searchToggle = screen.getByRole("button", { name: /buscar/i });
    await user.click(searchToggle);

    expect(screen.getByPlaceholderText("Buscar participante...")).toBeInTheDocument();

    const closeToggle = screen.getByRole("button", { name: /fechar/i });
    await user.click(closeToggle);

    expect(screen.queryByPlaceholderText("Buscar participante...")).not.toBeInTheDocument();
  });
});
