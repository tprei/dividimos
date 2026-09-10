import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupsListContent } from "./groups-list-content";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { LedgerError } from "@/lib/sync/errors";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
}));

const refreshGroup = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  createGroup: vi.fn(),
  acceptInvitation: vi.fn(),
  declineInvitation: vi.fn(),
}));

vi.mock("@/lib/sync/refresh", () => ({
  refreshGroup,
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
    expenseCount?: number;
    recentExpenses?: GroupSnapshot["recentExpenses"];
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
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    pairwiseEdges: [],
  };
  return {
    ...base,
    ...overrides,
    members: (overrides.members ?? base.members).map((item) => ({
      ...item,
      groupId,
    })),
    group: { ...base.group, ...overrides.group },
  };
}

function seed(snapshots: GroupSnapshot[], hydrated = true) {
  const groups: Record<string, GroupSnapshot> = {};
  for (const item of snapshots) groups[item.group.id] = item;
  useAppStore.setState({
    hydrated,
    me,
    groups,
    groupOrder: snapshots.map((item) => item.group.id),
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
  vi.clearAllMocks();
});

describe("GroupsListContent", () => {
  it("renders accepted members and the authoritative expense count", () => {
    seed([
      snapshot("g1", {
        group: { name: "Viagem" },
        members: [
          member("user-1", "Alice", "accepted"),
          member("user-2", "Carol", "accepted"),
          member("user-3", "Dave", "invited"),
        ],
        balances: [{ kind: "user", participantId: "user-1", netCents: 5000 }],
        expenseCount: 7,
        recentExpenses: [
          {
            id: "expense-1",
            groupId: "g1",
            creatorId: "user-1",
            status: "active",
            occurredOn: "2026-01-01",
            createdAt: "2026-01-01T00:00:00Z",
            versionNo: 1,
            title: "Jantar",
            merchantName: null,
            expenseType: "single_amount",
            totalCents: 1000,
            myShareCents: 500,
            myPaidCents: 1000,
            participantCount: 2,
          },
        ],
      }),
    ]);

    render(<GroupsListContent />);

    expect(screen.getByText("Viagem")).toBeInTheDocument();
    expect(screen.getByText("2 membros · 7 contas")).toBeInTheDocument();
    expect(screen.queryByText("3 membros · 1 contas")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Viagem/ })).toHaveAttribute(
      "href",
      "/app/groups/g1",
    );
  });

  it("renders a signed receivable and an in-day balance", () => {
    seed([
      snapshot("g1", {
        members: [member("user-1", "Alice", "accepted")],
        balances: [{ kind: "user", participantId: "user-1", netCents: 5000 }],
      }),
      snapshot("g2", {
        group: { name: "Sem saldo" },
        members: [member("user-1", "Alice", "accepted")],
      }),
    ]);

    render(<GroupsListContent />);

    expect(screen.getByText("A receber")).toBeInTheDocument();
    expect(screen.getByText("Em dia")).toBeInTheDocument();
  });

  it("renders a payable signed balance", () => {
    seed([
      snapshot("g1", {
        members: [member("user-1", "Alice", "accepted")],
        balances: [{ kind: "user", participantId: "user-1", netCents: -2500 }],
      }),
    ]);

    render(<GroupsListContent />);

    expect(screen.getByText("A pagar")).toBeInTheDocument();
  });

  it("excludes DMs and groups where the viewer is not accepted", () => {
    seed([
      snapshot("dm1", {
        group: { kind: "dm", name: "Conversa direta" },
        members: [member("user-1", "Alice", "accepted")],
      }),
      snapshot("pending", {
        group: { name: "Ainda não" },
        members: [
          member("user-1", "Alice", "invited", "user-2"),
          member("user-2", "Carol", "accepted"),
        ],
      }),
      snapshot("joined", {
        group: { name: "Grupo aceito" },
        members: [member("user-1", "Alice", "accepted")],
      }),
    ]);

    render(<GroupsListContent />);

    expect(screen.queryByRole("link", { name: /Conversa direta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ainda não/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Grupo aceito/ })).toBeInTheDocument();
    expect(screen.getByText("Convite · Ainda não")).toBeInTheDocument();
  });

  it("removes an invitation only after the accepted snapshot lands", async () => {
    const invitedSnapshot = snapshot("g2", {
      group: { name: "Casa nova" },
      members: [
        member("user-1", "Alice", "invited", "user-2"),
        member("user-2", "Carol", "accepted"),
      ],
    });
    const acceptedSnapshot = snapshot("g2", {
      group: { name: "Casa nova", ledgerVersion: 2 },
      members: [
        member("user-1", "Alice", "accepted"),
        member("user-2", "Carol", "accepted"),
      ],
    });
    seed([invitedSnapshot]);

    let resolveAccept!: () => void;
    const acceptPromise = new Promise<{ groupId: string; ledgerVersion: number; eventId: number }>((resolve) => {
      resolveAccept = () => {
        useAppStore.getState().applyGroup(acceptedSnapshot);
        resolve({ groupId: "g2", ledgerVersion: 2, eventId: 1 });
      };
    });
    vi.mocked(acceptInvitation).mockReturnValueOnce(acceptPromise);

    render(<GroupsListContent />);

    await userEvent.click(
      screen.getByRole("button", { name: "Aceitar convite para Casa nova" }),
    );
    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith("g2");
    });
    expect(screen.getByText("Convite · Casa nova")).toBeInTheDocument();
    expect(refreshGroup).not.toHaveBeenCalled();

    await act(async () => {
      resolveAccept();
      await acceptPromise;
    });

    await waitFor(() => {
      expect(screen.queryByText("Convite · Casa nova")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /Casa nova/ })).toBeInTheDocument();
  });

  it("keeps a failed invitation visible and shows the error toast", async () => {
    seed([
      snapshot("g2", {
        group: { name: "Casa nova" },
        members: [
          member("user-1", "Alice", "invited", "user-2"),
          member("user-2", "Carol", "accepted"),
        ],
      }),
    ]);
    vi.mocked(acceptInvitation).mockRejectedValueOnce(new LedgerError("network"));

    render(<GroupsListContent />);

    await userEvent.click(
      screen.getByRole("button", { name: "Aceitar convite para Casa nova" }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Sem conexão. Tente de novo quando a internet voltar.",
      );
    });
    expect(screen.getByText("Convite · Casa nova")).toBeInTheDocument();
    expect(refreshGroup).not.toHaveBeenCalled();
  });

  it("declines an invitation through the shared action", async () => {
    seed([
      snapshot("g2", {
        group: { name: "Casa nova" },
        members: [
          member("user-1", "Alice", "invited", "user-2"),
          member("user-2", "Carol", "accepted"),
        ],
      }),
    ]);
    vi.mocked(declineInvitation).mockResolvedValue({
      groupId: "g2",
      ledgerVersion: 1,
      eventId: 1,
    });

    render(<GroupsListContent />);
    await userEvent.click(
      screen.getByRole("button", { name: "Recusar convite para Casa nova" }),
    );

    await waitFor(() => {
      expect(declineInvitation).toHaveBeenCalledWith("g2");
    });
    expect(toast.success).toHaveBeenCalledWith("Convite recusado");
  });

  it("creates a group and navigates to its detail", async () => {
    seed([
      snapshot("g1", {
        members: [member("user-1", "Alice", "accepted")],
      }),
    ]);
    vi.mocked(createGroup).mockResolvedValue({
      groupId: "g-new",
      ledgerVersion: 1,
      eventId: null,
    });

    render(<GroupsListContent />);

    await userEvent.click(screen.getByRole("button", { name: "Novo grupo" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Nome do grupo" }),
      "Viagem pra praia",
    );
    await userEvent.click(screen.getByRole("button", { name: "Criar grupo" }));

    await waitFor(() => {
      expect(createGroup).toHaveBeenCalledWith("Viagem pra praia", []);
      expect(routerMock.push).toHaveBeenCalledWith("/app/groups/g-new");
    });
  });

  it("shows an error when creation fails", async () => {
    seed([
      snapshot("g1", {
        members: [member("user-1", "Alice", "accepted")],
      }),
    ]);
    vi.mocked(createGroup).mockRejectedValueOnce(new LedgerError("invalid_name"));

    render(<GroupsListContent />);

    await userEvent.click(screen.getByRole("button", { name: "Novo grupo" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Nome do grupo" }),
      "X",
    );
    await userEvent.click(screen.getByRole("button", { name: "Criar grupo" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Esse nome não vale. Use entre 1 e 80 caracteres.",
      );
    });
  });

  it("shows a skeleton before hydration", () => {
    seed([snapshot("g1", { group: { name: "Viagem" } })], false);

    render(<GroupsListContent />);

    expect(screen.queryByText("Viagem")).not.toBeInTheDocument();
  });

  it("shows the empty state with no groups and no invitations", () => {
    seed([]);

    render(<GroupsListContent />);

    expect(screen.getByText("Nenhum grupo ainda")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar grupo" })).toBeInTheDocument();
  });
});
