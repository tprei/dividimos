import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupsListContent } from "./groups-list-content";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Me } from "@/types/ledger";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  createGroup: vi.fn(),
  acceptInvitation: vi.fn(),
  declineInvitation: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import toast from "react-hot-toast";
import {
  acceptInvitation,
  createGroup,
  declineInvitation,
} from "@/lib/sync/mutations-group";

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice",
  avatarUrl: null,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

function member(
  userId: string,
  name: string,
  status: "invited" | "accepted",
  invitedBy: string | null = null,
) {
  return {
    groupId: "",
    userId,
    status,
    invitedBy,
    acceptedAt: null,
    user: { id: userId, handle: name.toLowerCase(), name, avatarUrl: null },
  };
}

function snapshot(
  groupId: string,
  overrides: {
    group?: Partial<GroupSnapshot["group"]>;
    members?: GroupSnapshot["members"];
    balances?: GroupSnapshot["balances"];
    unreadCount?: number;
  } = {},
): GroupSnapshot {
  const base: GroupSnapshot = {
    group: {
      id: groupId,
      kind: "group",
      name: `Grupo ${groupId}`,
      creatorId: "user-2",
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [],
    balances: [],
    guests: [],
    pendingSettlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
  };
  return {
    ...base,
    ...overrides,
    members: (overrides.members ?? base.members).map((m) => ({
      ...m,
      groupId,
    })),
    group: { ...base.group, ...overrides.group },
  };
}

function seed(snapshots: GroupSnapshot[], hydrated = true) {
  const groups: Record<string, GroupSnapshot> = {};
  for (const s of snapshots) groups[s.group.id] = s;
  useAppStore.setState({
    hydrated,
    me,
    groups,
    groupOrder: snapshots.map((s) => s.group.id),
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(createGroup).mockResolvedValue({
    groupId: "g-new",
    ledgerVersion: 1,
    eventId: null,
  });
});

describe("GroupsListContent", () => {
  it("lista grupos com nome, contagem, saldo a receber e não lidas", () => {
    seed([
      snapshot("g1", {
        group: { name: "Viagem" },
        members: [
          member("user-1", "Alice", "accepted"),
          member("user-2", "Carol", "accepted"),
          member("user-3", "Dave", "accepted"),
        ],
        balances: [{ kind: "user", participantId: "user-1", netCents: 5000 }],
        unreadCount: 2,
      }),
    ]);

    render(<GroupsListContent />);

    expect(screen.getByText("Viagem")).toBeInTheDocument();
    expect(screen.getByText(/3 membros/)).toBeInTheDocument();
    expect(screen.getByText(/a receber R\$ 50,00/)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("mostra saldo a pagar quando negativo", () => {
    seed([
      snapshot("g1", {
        members: [member("user-1", "Alice", "accepted")],
        balances: [{ kind: "user", participantId: "user-1", netCents: -2500 }],
      }),
    ]);

    render(<GroupsListContent />);

    expect(screen.getByText(/a pagar R\$ 25,00/)).toBeInTheDocument();
  });

  it("exclui DMs da lista", () => {
    seed([
      snapshot("dm1", {
        group: { kind: "dm", name: "Carol" },
        members: [member("user-1", "Alice", "accepted")],
      }),
      snapshot("g1", {
        members: [member("user-1", "Alice", "accepted")],
      }),
    ]);

    render(<GroupsListContent />);

    expect(screen.queryByText("Carol")).not.toBeInTheDocument();
    expect(screen.getByText("Grupo g1")).toBeInTheDocument();
  });

  it("mostra convites pendentes e responde aceitar/recusar", async () => {
    seed([
      snapshot("g2", {
        group: { name: "Casa nova" },
        members: [
          member("user-1", "Alice", "invited", "user-2"),
          member("user-2", "Carol", "accepted"),
        ],
      }),
    ]);

    render(<GroupsListContent />);

    expect(screen.getByText("Convites pendentes")).toBeInTheDocument();
    expect(screen.getByText("Convidado por Carol")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    expect(acceptInvitation).toHaveBeenCalledWith("g2");

    await userEvent.click(screen.getByRole("button", { name: "Recusar" }));
    expect(declineInvitation).toHaveBeenCalledWith("g2");
  });

  it("cria grupo e navega para o detalhe", async () => {
    seed([
      snapshot("g1", {
        members: [member("user-1", "Alice", "accepted")],
      }),
    ]);

    render(<GroupsListContent />);

    await userEvent.click(screen.getByRole("button", { name: /Novo/ }));
    await userEvent.type(
      screen.getByPlaceholderText("Nome do grupo"),
      "Viagem pra praia",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Criar grupo" }),
    );

    await waitFor(() => {
      expect(createGroup).toHaveBeenCalledWith("Viagem pra praia", []);
      expect(routerMock.push).toHaveBeenCalledWith("/app/groups/g-new");
    });
  });

  it("mostra erro quando a criação falha", async () => {
    vi.mocked(createGroup).mockRejectedValueOnce(new Error("invalid_name"));
    seed([
      snapshot("g1", {
        members: [member("user-1", "Alice", "accepted")],
      }),
    ]);

    render(<GroupsListContent />);

    await userEvent.click(screen.getByRole("button", { name: /Novo/ }));
    await userEvent.type(screen.getByPlaceholderText("Nome do grupo"), "X");
    await userEvent.click(
      screen.getByRole("button", { name: "Criar grupo" }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("mostra skeleton antes da hidratação", () => {
    seed([snapshot("g1", { group: { name: "Viagem" } })], false);

    render(<GroupsListContent />);

    expect(screen.queryByText("Viagem")).not.toBeInTheDocument();
  });

  it("mostra estado vazio sem grupos nem convites", () => {
    seed([]);

    render(<GroupsListContent />);

    expect(screen.getByText("Nenhum grupo ainda")).toBeInTheDocument();
  });
});
