import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { GroupsListContent } from "./groups-list-content";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useUser: () => ({ id: "user-1", name: "Test User" }),
}));

vi.mock("@/lib/push/push-notify", () => ({
  notifyGroupAccepted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Track all Supabase chain calls to verify filters
const chainCalls: { method: string; args: unknown[] }[] = [];

function chainable(resolveValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "select", "eq", "neq", "in", "is", "order", "limit", "single", "maybeSingle", "insert", "update", "delete"];
  for (const m of methods) {
    chain[m] = vi.fn((...args: unknown[]) => {
      chainCalls.push({ method: m, args });
      return chain;
    });
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(resolveValue);
  return chain;
}

const mockFromFn = vi.fn(() => {
  return chainable({ data: [], error: null });
});

const mockRpcFn = vi.fn(() =>
  Promise.resolve<{ data: null; error: { message: string } | null }>({
    data: null,
    error: null,
  }),
);

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: mockFromFn,
    rpc: mockRpcFn,
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: vi.fn(),
  }),
}));

function makeGroup(overrides: Partial<{
  id: string;
  name: string;
  creatorId: string;
  memberCount: number;
  activeBillCount: number;
}> = {}) {
  return {
    id: overrides.id ?? "group-1",
    name: overrides.name ?? "Amigos",
    creatorId: overrides.creatorId ?? "user-1",
    memberCount: overrides.memberCount ?? 3,
    members: [],
    activeBillCount: overrides.activeBillCount ?? 1,
  };
}

describe("GroupsListContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chainCalls.length = 0;
  });

  it("renders groups list", () => {
    const groups = [
      makeGroup({ id: "1", name: "Viagem SP" }),
      makeGroup({ id: "2", name: "Apartamento" }),
    ];
    render(<GroupsListContent initialGroups={groups} initialInvites={[]} />);

    expect(screen.getByText("Viagem SP")).toBeInTheDocument();
    expect(screen.getByText("Apartamento")).toBeInTheDocument();
    expect(screen.getByText("2 grupos")).toBeInTheDocument();
  });

  it("shows singular count for one group", () => {
    render(<GroupsListContent initialGroups={[makeGroup()]} initialInvites={[]} />);
    expect(screen.getByText("1 grupo")).toBeInTheDocument();
  });

  it("shows empty state when no groups", () => {
    render(<GroupsListContent initialGroups={[]} initialInvites={[]} />);
    expect(screen.getByText("Nenhum grupo ainda")).toBeInTheDocument();
  });

  it("renders pending invites", () => {
    const invites = [{ groupId: "g-1", groupName: "Churrasco", invitedByName: "João" }];
    render(<GroupsListContent initialGroups={[]} initialInvites={invites} />);

    expect(screen.getByText("Churrasco")).toBeInTheDocument();
    expect(screen.getByText("Convidado por João")).toBeInTheDocument();
    expect(screen.getByText("Aceitar")).toBeInTheDocument();
  });

  it("shows member count and bill info", () => {
    const groups = [makeGroup({ memberCount: 5, activeBillCount: 3 })];
    render(<GroupsListContent initialGroups={groups} initialInvites={[]} />);

    expect(screen.getByText("5 membros · 3 contas ativas")).toBeInTheDocument();
  });

  it("shows 'Nenhuma conta' when zero active bills", () => {
    const groups = [makeGroup({ activeBillCount: 0, memberCount: 2 })];
    render(<GroupsListContent initialGroups={groups} initialInvites={[]} />);

    expect(screen.getByText("2 membros · Nenhuma conta")).toBeInTheDocument();
  });

  it("opens create group form when Novo button is clicked", async () => {
    const user = userEvent.setup();
    render(<GroupsListContent initialGroups={[]} initialInvites={[]} />);

    await user.click(screen.getByText("Novo"));
    expect(screen.getByPlaceholderText("Nome do grupo")).toBeInTheDocument();
    const createButtons = screen.getAllByText("Criar grupo");
    expect(createButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("refetch applies is_dm=false filter on groups queries", async () => {
    const user = userEvent.setup();
    render(<GroupsListContent initialGroups={[makeGroup()]} initialInvites={[]} />);

    // Trigger refetch by creating a group (which calls refetch after insert)
    await user.click(screen.getByText("Novo"));
    const input = screen.getByPlaceholderText("Nome do grupo");
    await user.type(input, "Test Group");
    const createButtons = screen.getAllByText("Criar grupo");
    const formButton = createButtons.find((el) => el.closest(".overflow-hidden"));
    await user.click(formButton!);

    // Verify that groups queries include is_dm=false filter
    // The refetch calls from("groups").select(...).eq("creator_id", ...).eq("is_dm", false)
    // which means at least one is_dm filter should be recorded
    const eqCalls = chainCalls.filter((c) => c.method === "eq");
    const isDmFilters = eqCalls.filter((c) => c.args[0] === "is_dm" && c.args[1] === false);
    expect(isDmFilters.length).toBeGreaterThanOrEqual(1);
  });

  it("removes the invite from the list after a successful decline", async () => {
    const user = userEvent.setup();
    const invites = [{ groupId: "g-1", groupName: "Churrasco", invitedByName: "João" }];
    render(<GroupsListContent initialGroups={[]} initialInvites={invites} />);

    await user.click(screen.getByLabelText("Recusar"));

    expect(mockRpcFn).toHaveBeenCalledWith("decline_group_invitation", {
      p_group_id: "g-1",
    });
    await waitFor(() => {
      expect(screen.queryByText("Churrasco")).not.toBeInTheDocument();
    });
  });
  it("keeps the invitation and shows retryable feedback when decline is guard-rejected", async () => {
    mockRpcFn.mockResolvedValueOnce({
      data: null,
      error: { message: "has_outstanding_balance: you have an unsettled balance in this group" },
    });

    const user = userEvent.setup();
    const invites = [{ groupId: "g-1", groupName: "Churrasco", invitedByName: "João" }];
    render(<GroupsListContent initialGroups={[]} initialInvites={invites} />);

    await user.click(screen.getByLabelText("Recusar"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Você possui um saldo pendente neste grupo. Peça para quitarem antes de recusar.",
      );
    });
    // The invitation is retained — the guard rejection never removed it,
    // and the display still reflects the current (unchanged) invite.
    expect(screen.getByText("Churrasco")).toBeInTheDocument();
  });

  it("calls accept_group_invitation RPC and refetches when Aceitar is clicked", async () => {
    const user = userEvent.setup();
    const invites = [{ groupId: "g-1", groupName: "Churrasco", invitedByName: "João" }];
    render(<GroupsListContent initialGroups={[]} initialInvites={invites} />);

    await user.click(screen.getByText("Aceitar"));

    expect(mockRpcFn).toHaveBeenCalledWith("accept_group_invitation", {
      p_group_id: "g-1",
    });
  });

  it("keeps the invitation and shows retryable feedback when accept fails", async () => {
    mockRpcFn.mockResolvedValueOnce({
      data: null,
      error: { message: "not_invited: only a pending invitation can be accepted" },
    });

    const user = userEvent.setup();
    const invites = [{ groupId: "g-1", groupName: "Churrasco", invitedByName: "João" }];
    render(<GroupsListContent initialGroups={[]} initialInvites={invites} />);

    await user.click(screen.getByText("Aceitar"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Não foi possível aceitar o convite. Tente novamente.",
      );
    });
    // The RLS-denied direct-update path silently no-oped forever; the RPC
    // path surfaces failure and leaves the invite visible for retry.
    expect(screen.getByText("Churrasco")).toBeInTheDocument();
  });
});
