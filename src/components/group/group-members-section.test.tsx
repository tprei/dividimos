import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupMembersSection } from "./group-members-section";
import { InviteByHandlePanel } from "./group-invite-panel";
import type { GroupMember, GroupSnapshot, UserProfile } from "@/types/ledger";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("qrcode", () => ({
  default: { toCanvas: vi.fn() },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  removeMember: vi.fn(),
  leaveGroup: vi.fn(),
  deleteGroup: vi.fn(),
  lookupUserByHandle: vi.fn(),
  inviteMember: vi.fn(),
  issueGuestClaimToken: vi.fn(),
}));

import toast from "react-hot-toast";
import {
  deleteGroup,
  inviteMember,
  issueGuestClaimToken,
  leaveGroup,
  lookupUserByHandle,
  removeMember,
} from "@/lib/sync/mutations-group";

const groupId = "g1";
const meId = "user-me";
const creatorId = "user-creator";

function member(
  userId: string,
  name: string,
  status: GroupMember["status"] = "accepted",
): GroupMember {
  return {
    groupId,
    userId,
    status,
    invitedBy: null,
    acceptedAt: null,
    user: { id: userId, handle: name.toLowerCase(), name, avatarUrl: null },
  };
}

function snapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return {
    group: {
      id: groupId,
      kind: "group",
      name: "Viagem",
      creatorId,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      member(creatorId, "Carol Criadora"),
      member(meId, "Eu Mesmo"),
      member("user-3", "Dave Convidado", "invited"),
    ],
    balances: [],
    guests: [{ id: "guest-1", displayName: "Bruno", expenseId: "e1" }],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    pairwiseEdges: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GroupMembersSection", () => {
  it("renders members with status chips for self, creator and guests", () => {
    render(
      <GroupMembersSection
        snapshot={snapshot()}
        meId={meId}
        onDepart={vi.fn()}
      />,
    );

    expect(screen.getByText("Carol Criadora")).toBeInTheDocument();
    expect(screen.getByText("Criador")).toBeInTheDocument();
    expect(screen.getByText("Eu Mesmo")).toBeInTheDocument();
    expect(screen.getByText("Você")).toBeInTheDocument();
    expect(screen.getByText("Dave Convidado")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText("Bruno")).toBeInTheDocument();
    expect(screen.getByText("Convidado")).toBeInTheDocument();
  });

  it("shows Leave group and not Delete for a non-creator member", () => {
    render(
      <GroupMembersSection
        snapshot={snapshot()}
        meId={meId}
        onDepart={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Sair do grupo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Excluir grupo/ })).not.toBeInTheDocument();
  });

  it("shows Delete group and per-member remove buttons for the creator", () => {
    render(
      <GroupMembersSection
        snapshot={snapshot()}
        meId={creatorId}
        onDepart={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Excluir grupo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sair do grupo/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remover Eu Mesmo" }),
    ).toBeInTheDocument();
  });

  it("lets the creator remove a member after confirming", async () => {
    vi.mocked(removeMember).mockResolvedValue({
      groupId,
      ledgerVersion: 2,
      eventId: 1,
    });

    render(
      <GroupMembersSection
        snapshot={snapshot()}
        meId={creatorId}
        onDepart={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Remover Eu Mesmo" }));
    expect(screen.getByRole("heading", { name: "Remover membro" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remover" }));

    await waitFor(() => {
      expect(removeMember).toHaveBeenCalledWith(groupId, meId);
      expect(toast.success).toHaveBeenCalledWith("Membro removido do grupo.");
    });
  });

  it("lets a member leave the group and calls onDepart", async () => {
    vi.mocked(leaveGroup).mockResolvedValue({
      groupId,
      ledgerVersion: 2,
      eventId: 1,
    });
    const onDepart = vi.fn();

    render(
      <GroupMembersSection
        snapshot={snapshot()}
        meId={meId}
        onDepart={onDepart}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Sair do grupo/ }));
    expect(screen.getByRole("heading", { name: "Sair do grupo" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sair" }));

    await waitFor(() => {
      expect(leaveGroup).toHaveBeenCalledWith(groupId);
      expect(onDepart).toHaveBeenCalled();
      expect(routerMock.replace).toHaveBeenCalledWith("/app/groups");
    });
  });

  it("lets the creator delete the group", async () => {
    vi.mocked(deleteGroup).mockResolvedValue(undefined);
    const onDepart = vi.fn();

    render(
      <GroupMembersSection
        snapshot={snapshot()}
        meId={creatorId}
        onDepart={onDepart}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Excluir grupo/ }));
    expect(screen.getByRole("heading", { name: "Excluir grupo" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => {
      expect(deleteGroup).toHaveBeenCalledWith(groupId);
      expect(onDepart).toHaveBeenCalled();
      expect(routerMock.replace).toHaveBeenCalledWith("/app/groups");
    });
  });

  it("allows sharing an invite with a guest", async () => {
    vi.mocked(issueGuestClaimToken).mockResolvedValue("claim_token_xyz");

    render(
      <GroupMembersSection
        snapshot={snapshot()}
        meId={meId}
        onDepart={vi.fn()}
      />,
    );

    const shareButton = screen.getByRole("button", { name: /Compartilhar convite/i });
    expect(shareButton).toBeInTheDocument();

    await userEvent.click(shareButton);

    await waitFor(() => {
      expect(issueGuestClaimToken).toHaveBeenCalledWith("guest-1");
    });
  });
});

describe("InviteByHandlePanel", () => {
  const members = [member(meId, "Eu"), member("u2", "Carol")];

  it("looks up a user by handle and sends an invite", async () => {
    const profile: UserProfile = {
      id: "u-found",
      handle: "dave",
      name: "Dave Lima",
      avatarUrl: null,
    };
    vi.mocked(lookupUserByHandle).mockResolvedValue(profile);
    vi.mocked(inviteMember).mockResolvedValue({
      groupId,
      ledgerVersion: 2,
      eventId: 1,
    });
    const onInvited = vi.fn();

    render(
      <InviteByHandlePanel
        groupId={groupId}
        members={members}
        onClose={vi.fn()}
        onInvited={onInvited}
      />,
    );

    const input = screen.getByPlaceholderText("handle do usuario");
    fireEvent.change(input, { target: { value: "@dave" } });
    await userEvent.click(screen.getByRole("button", { name: "Buscar handle" }));

    await waitFor(() => {
      expect(lookupUserByHandle).toHaveBeenCalledWith("dave");
    });

    expect(screen.getByText("Dave Lima")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Convidar" }));

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledWith(groupId, "u-found");
      expect(onInvited).toHaveBeenCalled();
    });
  });

  it("shows a message when the user is not found", async () => {
    vi.mocked(lookupUserByHandle).mockResolvedValue(null);

    render(
      <InviteByHandlePanel
        groupId={groupId}
        members={members}
        onClose={vi.fn()}
        onInvited={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("handle do usuario");
    fireEvent.change(input, { target: { value: "ninguem" } });
    await userEvent.click(screen.getByRole("button", { name: "Buscar handle" }));

    await waitFor(() => {
      expect(
        screen.getByText("Nenhum usuário encontrado com @ninguem"),
      ).toBeInTheDocument();
    });
  });

  it("warns when the user is already a member", async () => {
    const profile: UserProfile = {
      id: "u2",
      handle: "carol",
      name: "Carol",
      avatarUrl: null,
    };
    vi.mocked(lookupUserByHandle).mockResolvedValue(profile);

    render(
      <InviteByHandlePanel
        groupId={groupId}
        members={members}
        onClose={vi.fn()}
        onInvited={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText("handle do usuario");
    fireEvent.change(input, { target: { value: "carol" } });
    await userEvent.click(screen.getByRole("button", { name: "Buscar handle" }));

    await waitFor(() => {
      expect(screen.getByText("Já tá no grupo")).toBeInTheDocument();
    });
  });
});
