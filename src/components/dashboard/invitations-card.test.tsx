import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InvitationsCard } from "./invitations-card";
import type { HomeInvitationItem } from "./home-selectors";

function invitation(overrides: Partial<HomeInvitationItem> = {}): HomeInvitationItem {
  return {
    groupId: "g1",
    kind: "group",
    title: "Jantar",
    inviter: { id: "user-2", name: "Carol Souza", avatarUrl: null },
    ...overrides,
  };
}

function renderCard(invitations: HomeInvitationItem[], pendingGroupId: string | null = null) {
  const onAccept = vi.fn();
  const onDecline = vi.fn();
  const onOpen = vi.fn();
  render(
    <InvitationsCard
      invitations={invitations}
      pendingGroupId={pendingGroupId}
      onAccept={onAccept}
      onDecline={onDecline}
      onOpen={onOpen}
    />,
  );
  return { onAccept, onDecline, onOpen };
}

describe("InvitationsCard", () => {
  it("passes the invitation to the accept and decline actions", () => {
    const invited = invitation();
    const { onAccept, onDecline } = renderCard([invited]);

    fireEvent.click(screen.getByRole("button", { name: "Aceitar convite para grupo Jantar" }));
    fireEvent.click(screen.getByRole("button", { name: "Recusar convite para grupo Jantar" }));

    expect(onAccept).toHaveBeenCalledWith(invited);
    expect(onDecline).toHaveBeenCalledWith(invited);
  });

  it("disables both actions while its invitation is pending", () => {
    renderCard([invitation()], "g1");

    expect(screen.getByRole("button", { name: "Aceitar convite para grupo Jantar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Recusar convite para grupo Jantar" })).toBeDisabled();
    expect(screen.getByText("Respondendo…")).toBeInTheDocument();
  });

  it("collapses beyond three invitations until Ver todos", () => {
    renderCard([
      invitation({ groupId: "g1", title: "Grupo 1" }),
      invitation({ groupId: "g2", title: "Grupo 2" }),
      invitation({ groupId: "g3", title: "Grupo 3" }),
      invitation({ groupId: "g4", title: "Grupo 4" }),
    ]);
    expect(screen.getAllByRole("button", { name: /Aceitar convite/ })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Ver todos (4)" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Ver todos (4)" }));

    expect(screen.getAllByRole("button", { name: /Aceitar convite/ })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Ver menos" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Ver menos" }));

    expect(screen.getAllByRole("button", { name: /Aceitar convite/ })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Ver todos (4)" })).toBeInTheDocument();
  });

  it("renders nothing without invitations", () => {
    renderCard([]);

    expect(screen.queryByRole("region", { name: "Convites" })).not.toBeInTheDocument();
  });
});
