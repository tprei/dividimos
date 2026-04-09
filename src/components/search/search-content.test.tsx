import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchContent } from "./search-content";

const mockFrom = vi.fn<(table: string) => Record<string, unknown>>();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: mockFrom }),
}));

function chainable(data: unknown[] | null = []) {
  const obj: Record<string, unknown> = {
    data,
    error: null,
  };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (prop === "data") return target.data;
      if (prop === "error") return target.error;
      if (prop === "then") return undefined;
      return () => new Proxy(target, handler);
    },
  };
  return new Proxy(obj, handler);
}

function setupMocks({
  groups = [],
  expenses = [],
  people = [],
  balances = [],
  members = [],
}: {
  groups?: { id: string; name: string }[];
  expenses?: {
    id: string;
    title: string;
    merchant_name: string | null;
    total_amount: number;
    status: string;
    group_id: string;
  }[];
  people?: {
    id: string;
    handle: string;
    name: string;
    avatar_url: string | null;
  }[];
  balances?: {
    group_id: string;
    user_a: string;
    user_b: string;
    amount_cents: number;
  }[];
  members?: { group_id: string }[];
} = {}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "groups") {
      return chainable(groups);
    }
    if (table === "expenses") {
      return chainable(expenses);
    }
    if (table === "user_profiles") {
      return chainable(people);
    }
    if (table === "balances") {
      return chainable(balances);
    }
    if (table === "group_members") {
      return chainable(members);
    }
    return chainable([]);
  });
}

describe("SearchContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("renders the search heading and input", () => {
    render(<SearchContent userId="user-1" />);

    expect(screen.getByText("Busca")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Buscar grupos, contas, pessoas...")
    ).toBeInTheDocument();
  });

  it("does not search when query is less than 2 characters", async () => {
    render(<SearchContent userId="user-1" />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.type(
      screen.getByPlaceholderText("Buscar grupos, contas, pessoas..."),
      "a"
    );
    vi.advanceTimersByTime(400);

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("shows group results", async () => {
    setupMocks({
      groups: [{ id: "g1", name: "Amigos da facul" }],
      members: [{ group_id: "g1" }, { group_id: "g1" }],
    });

    render(<SearchContent userId="user-1" />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.type(
      screen.getByPlaceholderText("Buscar grupos, contas, pessoas..."),
      "Amigos"
    );
    vi.advanceTimersByTime(400);

    await waitFor(() => {
      expect(screen.getByText("Amigos da facul")).toBeInTheDocument();
    });
    expect(screen.getByText("Grupos")).toBeInTheDocument();
  });

  it("shows expense results with status badge and amount", async () => {
    setupMocks({
      expenses: [
        {
          id: "e1",
          title: "Churrasco",
          merchant_name: null,
          total_amount: 15000,
          status: "active",
          group_id: "g1",
        },
      ],
      groups: [{ id: "g1", name: "Família" }],
    });

    render(<SearchContent userId="user-1" />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.type(
      screen.getByPlaceholderText("Buscar grupos, contas, pessoas..."),
      "Churrasco"
    );
    vi.advanceTimersByTime(400);

    await waitFor(() => {
      expect(screen.getByText("Churrasco")).toBeInTheDocument();
    });
    expect(screen.getByText("Contas")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
  });

  it("shows people results", async () => {
    setupMocks({
      people: [
        { id: "u2", handle: "joao", name: "João Silva", avatar_url: null },
      ],
    });

    render(<SearchContent userId="user-1" />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.type(
      screen.getByPlaceholderText("Buscar grupos, contas, pessoas..."),
      "João"
    );
    vi.advanceTimersByTime(400);

    await waitFor(() => {
      expect(screen.getByText("João Silva")).toBeInTheDocument();
    });
    expect(screen.getByText("@joao")).toBeInTheDocument();
    expect(screen.getByText("Pessoas")).toBeInTheDocument();
  });

  it("shows empty state when no results found", async () => {
    setupMocks();

    render(<SearchContent userId="user-1" />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.type(
      screen.getByPlaceholderText("Buscar grupos, contas, pessoas..."),
      "xyznotfound"
    );
    vi.advanceTimersByTime(400);

    await waitFor(() => {
      expect(screen.getByText("Nenhum resultado")).toBeInTheDocument();
    });
  });

  it("excludes the current user from people results", async () => {
    setupMocks({
      people: [
        { id: "user-1", handle: "me", name: "Eu Mesmo", avatar_url: null },
        { id: "u2", handle: "joao", name: "João", avatar_url: null },
      ],
    });

    render(<SearchContent userId="user-1" />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.type(
      screen.getByPlaceholderText("Buscar grupos, contas, pessoas..."),
      "test"
    );
    vi.advanceTimersByTime(400);

    await waitFor(() => {
      expect(screen.getByText("João")).toBeInTheDocument();
    });
    expect(screen.queryByText("Eu Mesmo")).not.toBeInTheDocument();
  });

  it("shows balance info for people with debts", async () => {
    setupMocks({
      people: [
        { id: "u2", handle: "joao", name: "João", avatar_url: null },
      ],
      balances: [
        {
          group_id: "g1",
          user_a: "user-1",
          user_b: "u2",
          amount_cents: 5000,
        },
      ],
    });

    render(<SearchContent userId="user-1" />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.type(
      screen.getByPlaceholderText("Buscar grupos, contas, pessoas..."),
      "João"
    );
    vi.advanceTimersByTime(400);

    await waitFor(() => {
      expect(screen.getByText("João")).toBeInTheDocument();
    });
    expect(screen.getByText(/Você deve/)).toBeInTheDocument();
  });
});
