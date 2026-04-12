import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GroupSelector } from "./group-selector";
import { createClient } from "@/lib/supabase/client";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: { selectionChanged: vi.fn(), tap: vi.fn() },
}));

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

describe("GroupSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseData = {};
  });

  async function openDropdown() {
    // Wait for loading to finish (spinner disappears from button)
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /selecionar grupo/i });
      const spinner = btn.querySelector("[class*='animate-spin']");
      expect(spinner).toBeFalsy();
    });
    fireEvent.click(screen.getByRole("button", { name: /selecionar grupo/i }));
  }

  it("sorts groups by most recent expense (most recent first)", async () => {
    supabaseData = {
      group_members: [
        { group_id: "g1", user_id: "me", status: "accepted" },
        { group_id: "g2", user_id: "me", status: "accepted" },
        { group_id: "g1", user_id: "u1", status: "accepted" },
        { group_id: "g2", user_id: "u2", status: "accepted" },
      ],
      groups: [
        { id: "g1", name: "Velhos amigos", creator_id: "me" },
        { id: "g2", name: "Recentes amigos", creator_id: "me" },
      ],
      user_profiles: [
        { id: "u1", handle: "user1", name: "User One", avatar_url: null },
        { id: "u2", handle: "user2", name: "User Two", avatar_url: null },
      ],
      expenses: [
        { group_id: "g2", created_at: "2026-04-09T10:00:00Z" },
        { group_id: "g1", created_at: "2026-01-01T10:00:00Z" },
      ],
    };

    render(
      <GroupSelector
        currentUserId="me"
        excludeIds={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
      />,
    );

    await openDropdown();

    const items = screen.getAllByText(/amigos/);
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("Recentes amigos");
    expect(items[1].textContent).toContain("Velhos amigos");
  });

  it("shows 'Recente' badge on the most recently used group", async () => {
    supabaseData = {
      group_members: [
        { group_id: "g1", user_id: "me", status: "accepted" },
        { group_id: "g1", user_id: "u1", status: "accepted" },
      ],
      groups: [
        { id: "g1", name: "Grupo Top", creator_id: "me" },
      ],
      user_profiles: [
        { id: "u1", handle: "alice", name: "Alice", avatar_url: null },
      ],
      expenses: [
        { group_id: "g1", created_at: "2026-04-09T12:00:00Z" },
      ],
    };

    render(
      <GroupSelector
        currentUserId="me"
        excludeIds={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
      />,
    );

    await openDropdown();

    expect(screen.getByText("Recente")).toBeInTheDocument();
  });

  it("groups with no expenses sort alphabetically", async () => {
    supabaseData = {
      group_members: [
        { group_id: "g1", user_id: "me", status: "accepted" },
        { group_id: "g2", user_id: "me", status: "accepted" },
        { group_id: "g1", user_id: "u1", status: "accepted" },
        { group_id: "g2", user_id: "u2", status: "accepted" },
      ],
      groups: [
        { id: "g1", name: "Zebra group", creator_id: "me" },
        { id: "g2", name: "Alpha group", creator_id: "me" },
      ],
      user_profiles: [
        { id: "u1", handle: "u1", name: "U1", avatar_url: null },
        { id: "u2", handle: "u2", name: "U2", avatar_url: null },
      ],
      expenses: [],
    };

    render(
      <GroupSelector
        currentUserId="me"
        excludeIds={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
      />,
    );

    await openDropdown();

    const items = screen.getAllByText(/group/);
    expect(items[0].textContent).toContain("Alpha group");
    expect(items[1].textContent).toContain("Zebra group");
  });

  it("shows spinner icon in button and skeleton rows while loading", async () => {
    // Use a deferred promise so loading stays true until we release it
    let resolveGroups!: (v: { data: unknown[] }) => void;
    const groupsPromise = new Promise<{ data: unknown[] }>((r) => {
      resolveGroups = r;
    });
    const deferredBuilder = Object.assign(groupsPromise, {
      select: function () { return this; },
      eq: function () { return this; },
      neq: function () { return this; },
      in: function () { return this; },
      order: function () { return this; },
      single: function () { return this; },
    });

    vi.mocked(createClient).mockReturnValue({
      from: () => deferredBuilder,
    } as unknown as ReturnType<typeof createClient>);

    render(
      <GroupSelector
        currentUserId="me"
        excludeIds={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
      />,
    );

    // Button should show spinner icon while loading
    const btn = screen.getByRole("button", { name: /selecionar grupo/i });
    const spinner = btn.querySelector("[class*='animate-spin']");
    expect(spinner).toBeTruthy();

    // Open dropdown while still loading
    fireEvent.click(btn);

    // Should show skeleton rows, not text
    expect(screen.queryByText("Carregando grupos...")).not.toBeInTheDocument();
    expect(screen.queryByText("Nenhum grupo disponível")).not.toBeInTheDocument();
    const skeletonContainer = document.querySelector(".divide-y");
    expect(skeletonContainer).toBeTruthy();
    // 3 GroupRowSkeleton components each have child skeletons
    const shimmerElements = skeletonContainer!.querySelectorAll("[class*='shimmer']");
    expect(shimmerElements.length).toBeGreaterThanOrEqual(3);

    // Resolve loading and restore mock to clean up
    resolveGroups({ data: [] });

    // Restore the original mock so subsequent tests use supabaseData again
    vi.mocked(createClient).mockImplementation(() => ({
      from: (table: string) => createQueryBuilder(supabaseData[table] ?? []),
    }) as unknown as ReturnType<typeof createClient>);
  });

  it("shows empty state after loading completes with no groups", async () => {
    supabaseData = {
      group_members: [],
      groups: [],
      user_profiles: [],
      expenses: [],
    };

    render(
      <GroupSelector
        currentUserId="me"
        excludeIds={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
      />,
    );

    await openDropdown();

    expect(screen.getByText("Nenhum grupo disponível")).toBeInTheDocument();
  });

  it("does not show 'Recente' badge when no expenses exist", async () => {
    supabaseData = {
      group_members: [
        { group_id: "g1", user_id: "me", status: "accepted" },
        { group_id: "g1", user_id: "u1", status: "accepted" },
      ],
      groups: [
        { id: "g1", name: "Empty Group", creator_id: "me" },
      ],
      user_profiles: [
        { id: "u1", handle: "u1", name: "U1", avatar_url: null },
      ],
      expenses: [],
    };

    render(
      <GroupSelector
        currentUserId="me"
        excludeIds={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
      />,
    );

    await openDropdown();

    expect(screen.getByText("Empty Group")).toBeInTheDocument();
    expect(screen.queryByText("Recente")).not.toBeInTheDocument();
  });
});
