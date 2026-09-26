import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClaimerAvatars } from "./claimer-avatars";
import type { AssignmentRoomClaimer } from "@/types/assignment-room";

function claimer(participantId: string, name: string, userId: string | null = null): AssignmentRoomClaimer {
  return { participantId, userId, name, avatarUrl: null };
}

describe("ClaimerAvatars", () => {
  it("renders nothing when nobody marked items", () => {
    const { container } = render(<ClaimerAvatars claimers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("caps the visible stack but names everyone for screen readers", () => {
    render(
      <ClaimerAvatars
        claimers={[
          claimer("p1", "Ana Souza"),
          claimer("p2", "Bia Lima"),
          claimer("p3", "Caio Alves"),
          claimer("p4", "Duda Reis"),
          claimer("p5", "Elis Sol"),
        ]}
      />,
    );

    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Marcaram itens: Ana Souza, Bia Lima, Caio Alves, Duda Reis, Elis Sol",
    );
  });

  it("lists every name when nobody overflows", () => {
    render(<ClaimerAvatars claimers={[claimer("p1", "Ana Souza", "u1"), claimer("p2", "Bia Convidada")]} />);

    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Marcaram itens: Ana Souza, Bia Convidada");
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it("honors a tighter max", () => {
    render(
      <ClaimerAvatars
        claimers={[claimer("p1", "Ana Souza"), claimer("p2", "Bia Lima"), claimer("p3", "Caio Alves"), claimer("p4", "Duda Reis")]}
        max={1}
      />,
    );

    expect(screen.getByText("+3")).toBeInTheDocument();
  });
});
