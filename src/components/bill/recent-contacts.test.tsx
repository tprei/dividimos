import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RecentContacts } from "./recent-contacts";

function createQueryBuilder(data: unknown) {
  const promise = Promise.resolve({ data });
  const builder = Object.assign(promise, {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    order: () => builder,
    single: () => builder,
  });
  return builder;
}

let supabaseData: Record<string, unknown> = {};

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => createQueryBuilder(supabaseData[table] ?? []),
  })),
}));

describe("RecentContacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseData = {};
  });

  it("ranks contacts by co-expense frequency (most frequent first)", async () => {
    supabaseData = {
      expense_shares: [
        { expense_id: "e1", user_id: "me" },
        { expense_id: "e2", user_id: "me" },
        { expense_id: "e1", user_id: "alice" },
        { expense_id: "e2", user_id: "alice" },
        { expense_id: "e1", user_id: "bob" },
      ],
      expense_payers: [
        { expense_id: "e1", user_id: "me" },
      ],
      user_profiles: [
        { id: "alice", handle: "alice", name: "Alice Silva", avatar_url: null },
        { id: "bob", handle: "bob", name: "Bob Santos", avatar_url: null },
      ],
    };

    render(
      <RecentContacts
        onSelect={vi.fn()}
        excludeIds={[]}
        currentUserId="me"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole("button");
    expect(buttons[0].textContent).toContain("Alice");
    expect(buttons[1].textContent).toContain("Bob");
  });

  it("returns null when no contacts found", async () => {
    supabaseData = {
      expense_shares: [],
      expense_payers: [],
    };

    const { container } = render(
      <RecentContacts
        onSelect={vi.fn()}
        excludeIds={[]}
        currentUserId="me"
      />,
    );

    await waitFor(() => {
      expect(container.innerHTML).toBe("");
    });
  });

  it("filters out excluded contacts", async () => {
    supabaseData = {
      expense_shares: [
        { expense_id: "e1", user_id: "me" },
        { expense_id: "e1", user_id: "alice" },
      ],
      expense_payers: [],
      user_profiles: [
        { id: "alice", handle: "alice", name: "Alice Silva", avatar_url: null },
      ],
    };

    const { container } = render(
      <RecentContacts
        onSelect={vi.fn()}
        excludeIds={["alice"]}
        currentUserId="me"
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("button")).toBeNull();
    });
  });
});
