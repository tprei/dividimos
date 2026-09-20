import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GroupSpendingSection } from "./group-spending-section";

const spending = {
  totalCents: 12000,
  participants: [
    {
      kind: "user" as const,
      participantId: "alice",
      user: { id: "alice", handle: "@alice", name: "Alice", avatarUrl: null, isBot: false },
      shareCents: 4000,
    },
    {
      kind: "guest" as const,
      participantId: "guest-1",
      displayName: "Convidado",
      shareCents: 8000,
    },
  ],
};

describe("GroupSpendingSection", () => {
  it("does not turn an unavailable overview into a zero total", () => {
    render(<GroupSpendingSection spending={undefined} meId="alice" />);

    expect(screen.getByTestId("group-spending-loading")).toHaveTextContent("Carregando");
    expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("hides restricted spending while keeping a successful zero visible", () => {
    const { rerender } = render(<GroupSpendingSection spending={null} meId="alice" />);
    expect(screen.queryByTestId("group-spending")).not.toBeInTheDocument();

    rerender(<GroupSpendingSection spending={{ totalCents: 0, participants: [] }} meId="alice" />);
    expect(screen.getByTestId("group-spending")).toBeInTheDocument();
    expect(screen.getByText("R$ 0,00")).toBeInTheDocument();
  });

  it("sorts shares and labels the signed-in user and guests", () => {
    render(<GroupSpendingSection spending={spending} meId="alice" />);

    expect(screen.getByText("R$ 120,00")).toBeInTheDocument();
    expect(screen.getByText("Você")).toBeInTheDocument();
    expect(screen.getByText("Convidado", { selector: "span" })).toBeInTheDocument();
    const rows = screen.getAllByTestId(/group-spending-row-/);
    expect(rows[0]).toHaveTextContent("Convidado");
    expect(rows[1]).toHaveTextContent("Você");
  });
});
