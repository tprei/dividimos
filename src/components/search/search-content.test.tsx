import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SearchContent } from "./search-content";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, ExpenseSummary, Me } from "@/types/ledger";

vi.mock("@/lib/sync/mutations-group", () => ({
  lookupUserByHandle: vi.fn(),
}));

import { lookupUserByHandle } from "@/lib/sync/mutations-group";

const me: Me = {
  id: "user-me",
  handle: "eu",
  name: "Eu Mesmo",
  avatarUrl: null,
  email: "me@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

function makeGroup(id: string, name: string, members: Array<{ id: string; name: string; handle: string }>): GroupSnapshot {
  return {
    group: {
      id,
      name,
      kind: "group",
      creatorId: "user-me",
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: members.map((m) => ({
      groupId: id,
      userId: m.id,
      status: "accepted",
      invitedBy: null,
      acceptedAt: "2026-01-01T00:00:00Z",
      user: {
        id: m.id,
        name: m.name,
        handle: m.handle,
        avatarUrl: null,
      },
    })),
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00Z",
  };
}

function makeExpense(id: string, groupId: string, title: string, merchantName: string | null, totalCents: number): ExpenseSummary {
  return {
    id,
    groupId,
    creatorId: "user-me",
    versionNo: 1,
    status: "active",
    occurredOn: "2026-01-01",
    title,
    merchantName,
    expenseType: "single_amount",
    totalCents,
    myPaidCents: 0,
    myShareCents: 0,
    participantCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("SearchContent", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    vi.clearAllMocks();
  });

  it("renders prompt when search query is empty", () => {
    render(<SearchContent />);
    expect(
      screen.getByText("Digite para buscar grupos, contas ou pessoas"),
    ).toBeInTheDocument();
  });

  it("filters groups by name and links to /app/groups/<id>", () => {
    const group1 = makeGroup("g1", "Viagem Praia", []);
    const group2 = makeGroup("g2", "Churrasco Fim de Ano", []);
    useAppStore.getState().applyGroup(group1);
    useAppStore.getState().applyGroup(group2);

    render(<SearchContent />);
    const input = screen.getByPlaceholderText("Buscar grupos, contas, pessoas...");
    fireEvent.change(input, { target: { value: "Praia" } });

    expect(screen.getByText("Grupos")).toBeInTheDocument();
    expect(screen.getByText("Viagem Praia")).toBeInTheDocument();
    expect(screen.queryByText("Churrasco Fim de Ano")).not.toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Viagem Praia/i });
    expect(link).toHaveAttribute("href", "/app/groups/g1");
  });

  it("filters expenses by title and merchant name and links to /app/bill/<id>", () => {
    const group = makeGroup("g1", "Apartamento", []);
    useAppStore.getState().applyGroup(group);

    const exp1 = makeExpense("e1", "g1", "Supermercado", "Carrefour", 15000);
    const exp2 = makeExpense("e2", "g1", "Internet", "Vivo Fibra", 12000);
    useAppStore.getState().upsertExpense(exp1);
    useAppStore.getState().upsertExpense(exp2);

    render(<SearchContent />);
    const input = screen.getByPlaceholderText("Buscar grupos, contas, pessoas...");

    fireEvent.change(input, { target: { value: "Carrefour" } });
    expect(screen.getByText("Supermercado")).toBeInTheDocument();
    expect(screen.queryByText("Internet")).not.toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Supermercado/i });
    expect(link).toHaveAttribute("href", "/app/bill/e1");
  });

  it("filters members across groups excluding self and links to /app/conversations/<id>", () => {
    useAppStore.setState({ me });
    const group = makeGroup("g1", "Trabalho", [
      { id: "user-me", name: "Eu Mesmo", handle: "eu" },
      { id: "user-bob", name: "Bob Silva", handle: "bobsilva" },
      { id: "user-carol", name: "Carol Lima", handle: "carollima" },
    ]);
    useAppStore.getState().applyGroup(group);

    render(<SearchContent />);
    const input = screen.getByPlaceholderText("Buscar grupos, contas, pessoas...");

    fireEvent.change(input, { target: { value: "bob" } });
    expect(screen.getByText("Pessoas")).toBeInTheDocument();
    expect(screen.getByText("Bob Silva")).toBeInTheDocument();
    expect(screen.getByText("@bobsilva")).toBeInTheDocument();
    expect(screen.queryByText("Carol Lima")).not.toBeInTheDocument();
    expect(screen.queryByText("Eu Mesmo")).not.toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Bob Silva/i });
    expect(link).toHaveAttribute("href", "/app/conversations/user-bob");
  });

  it("performs debounced exact handle lookup when query matches handle pattern", async () => {
    vi.useFakeTimers();
    useAppStore.setState({ me });
    vi.mocked(lookupUserByHandle).mockResolvedValueOnce({
      id: "user-dan",
      name: "Daniel Santos",
      handle: "danielsantos",
      avatarUrl: null,
    });

    render(<SearchContent />);
    const input = screen.getByPlaceholderText("Buscar grupos, contas, pessoas...");

    fireEvent.change(input, { target: { value: "@danielsantos" } });
    expect(lookupUserByHandle).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(lookupUserByHandle).toHaveBeenCalledWith("danielsantos");

    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByText("Daniel Santos")).toBeInTheDocument();
      expect(screen.getByText("@danielsantos")).toBeInTheDocument();
    });

    const link = screen.getByRole("link", { name: /Daniel Santos/i });
    expect(link).toHaveAttribute("href", "/app/conversations/user-dan");
  });

  it("shows empty state when no results match", () => {
    render(<SearchContent />);
    const input = screen.getByPlaceholderText("Buscar grupos, contas, pessoas...");
    fireEvent.change(input, { target: { value: "inexistente" } });

    expect(screen.getByText("Nenhum resultado encontrado")).toBeInTheDocument();
    expect(
      screen.getByText(/Não encontramos nada para "inexistente"/i),
    ).toBeInTheDocument();
  });

  it("clears query when clicking the clear button", () => {
    render(<SearchContent />);
    const input = screen.getByPlaceholderText("Buscar grupos, contas, pessoas...");
    fireEvent.change(input, { target: { value: "teste" } });

    const clearBtn = screen.getByRole("button", { name: "Limpar busca" });
    fireEvent.click(clearBtn);

    expect(input).toHaveValue("");
    expect(
      screen.getByText("Digite para buscar grupos, contas ou pessoas"),
    ).toBeInTheDocument();
  });
});
