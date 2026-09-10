import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExpenseParticipantList } from "./expense-participant-list";
import type { Participant, UserProfile } from "@/types/ledger";

const carolProfile: UserProfile = {
  id: "user-2",
  handle: "carol",
  name: "Carol Souza",
  avatarUrl: null,
};

const daveProfile: UserProfile = {
  id: "user-3",
  handle: "dave",
  name: "Dave Lima",
  avatarUrl: null,
};

function userParticipant(index: number, user: UserProfile): Participant {
  return {
    participantIndex: index,
    kind: "user",
    shareCents: 5000,
    paidCents: 0,
    user,
    guest: null,
  };
}

describe("ExpenseParticipantList", () => {
  it("marks only the participant whose invite is pending", () => {
    render(
      <ExpenseParticipantList
        participants={[userParticipant(0, carolProfile), userParticipant(1, daveProfile)]}
        meId="user-1"
        invitedUserIds={new Set([carolProfile.id])}
        onInviteGuest={vi.fn()}
      />,
    );

    expect(screen.getByText("Convite pendente")).toBeInTheDocument();
  });
});
