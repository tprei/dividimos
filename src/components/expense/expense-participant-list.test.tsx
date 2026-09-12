import { render, screen, within } from "@testing-library/react";
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

describe("ExpenseParticipantList reconciliation", () => {
  it("shows consumed, paid, and signed balance for every row", () => {
    const carol: Participant = {
      ...userParticipant(0, carolProfile),
      paidCents: 12000,
    };
    const bruno: Participant = {
      participantIndex: 1,
      kind: "guest",
      shareCents: 5000,
      paidCents: 3000,
      user: null,
      guest: {
        id: "guest-1",
        displayName: "Bruno",
        claimedBy: "user-1",
        claimLinkGeneration: 0,
      },
    };
    render(
      <ExpenseParticipantList
        participants={[carol, bruno]}
        meId="user-1"
        invitedUserIds={new Set()}
        onInviteGuest={vi.fn()}
      />,
    );

    const rows = within(
      screen.getByRole("list", { name: "Participantes" }),
    ).getAllByRole("listitem");

    expect(
      within(rows[0]).getByText(
        (_, element) =>
          element?.textContent?.replace(/\s+/g, " ") ===
          "Consumiu R$ 50,00 · Pagou R$ 120,00",
      ),
    ).toBeInTheDocument();
    expect(
      within(rows[0])
        .getByLabelText("Saldo de Carol Souza nessa conta")
        .textContent,
    ).toBe("+R$\u00a070,00");

    expect(
      within(rows[1]).getByText(
        (_, element) =>
          element?.textContent?.replace(/\s+/g, " ") ===
          "Consumiu R$ 50,00 · Pagou R$ 30,00",
      ),
    ).toBeInTheDocument();
    expect(
      within(rows[1]).getByLabelText("Saldo de Bruno nessa conta").textContent,
    ).toBe("\u2212R$\u00a020,00");
  });

  it("omits the paid part of the sub-line for someone who paid nothing", () => {
    render(
      <ExpenseParticipantList
        participants={[userParticipant(0, carolProfile)]}
        meId="user-1"
        invitedUserIds={new Set()}
        onInviteGuest={vi.fn()}
      />,
    );

    const row = within(
      screen.getByRole("list", { name: "Participantes" }),
    ).getByRole("listitem");
    expect(
      within(row).getByText(
        (_, element) =>
          element?.textContent?.replace(/\s+/g, " ") === "Consumiu R$ 50,00",
      ),
    ).toBeInTheDocument();
    expect(within(row).getByLabelText("Saldo de Carol Souza nessa conta").textContent).toBe(
      "\u2212R$\u00a050,00",
    );
  });
});

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
