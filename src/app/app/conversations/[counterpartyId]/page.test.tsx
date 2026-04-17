import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Suspense } from "react";

// Mock getAuthUser
const mockUser = {
  id: "user-1",
  name: "Alice Test",
  email: "alice@test.com",
  handle: "alice",
  avatarUrl: undefined,
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  createdAt: "2026-01-01T00:00:00Z",
  notificationPreferences: {},
};

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(() => Promise.resolve(mockUser)),
}));

// Mock server supabase
const mockSupabaseData: Record<string, { data: unknown; error: unknown }> = {};
let mockRpcResult: { data: unknown; error: unknown } = { data: "dm-group-1", error: null };

function chainable(resolveValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "neq", "in", "is", "or", "order", "limit", "single", "maybeSingle", "insert", "delete", "update", "upsert"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(resolveValue);
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: vi.fn((table: string) => {
        const result = mockSupabaseData[table] ?? { data: [], error: null };
        return chainable(result);
      }),
      rpc: vi.fn(() => mockRpcResult),
    }),
  ),
}));

// Mock the client component to verify props
const mockClientComponent = vi.fn();
vi.mock("./conversation-page-client", () => ({
  ConversationPageClient: (props: unknown) => {
    mockClientComponent(props);
    return <div data-testid="conversation-client">Rendered</div>;
  },
}));

import ConversationPage from "./page";

async function renderPage(counterpartyId = "user-2") {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Suspense fallback={<div>Loading...</div>}>
        <ConversationPage params={Promise.resolve({ counterpartyId })} />
      </Suspense>,
    );
  });
  return result!;
}

describe("ConversationPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockRpcResult = { data: "dm-group-1", error: null };

    mockSupabaseData["user_profiles"] = {
      data: {
        id: "user-2",
        handle: "bob",
        name: "Bob Test",
        avatar_url: null,
      },
      error: null,
    };
    mockSupabaseData["chat_messages"] = { data: [], error: null };
    mockSupabaseData["group_members"] = {
      data: [
        { user_id: "user-1", status: "accepted" },
        { user_id: "user-2", status: "accepted" },
      ],
      error: null,
    };
    mockSupabaseData["conversation_read_receipts"] = { data: null, error: null };
  });

  it("renders client component with initial data", async () => {
    await renderPage();

    expect(screen.getByTestId("conversation-client")).toBeInTheDocument();
    expect(mockClientComponent).toHaveBeenCalledTimes(1);

    const props = mockClientComponent.mock.calls[0][0];
    expect(props.initialData.groupId).toBe("dm-group-1");
    expect(props.initialData.counterparty.handle).toBe("bob");
    expect(props.initialData.error).toBeNull();
  });

  it("passes error when DM group RPC fails", async () => {
    mockRpcResult = { data: null, error: { message: "Grupo não encontrado" } };

    await renderPage();

    const props = mockClientComponent.mock.calls[0][0];
    expect(props.initialData.error).toBe("Grupo não encontrado");
    expect(props.initialData.groupId).toBeNull();
  });

  it("passes error when counterparty profile not found", async () => {
    mockSupabaseData["user_profiles"] = { data: null, error: { message: "not found" } };

    await renderPage();

    const props = mockClientComponent.mock.calls[0][0];
    expect(props.initialData.error).toBe("Usuário não encontrado");
    expect(props.initialData.counterparty).toBeNull();
  });

  it("passes member statuses from group_members query", async () => {
    mockSupabaseData["group_members"] = {
      data: [
        { user_id: "user-1", status: "invited" },
        { user_id: "user-2", status: "accepted" },
      ],
      error: null,
    };

    await renderPage();

    const props = mockClientComponent.mock.calls[0][0];
    expect(props.initialData.callerStatus).toBe("invited");
    expect(props.initialData.counterpartyStatus).toBe("accepted");
  });

  it("passes currentUser from auth", async () => {
    await renderPage();

    const props = mockClientComponent.mock.calls[0][0];
    expect(props.initialData.currentUser.id).toBe("user-1");
    expect(props.initialData.currentUser.handle).toBe("alice");
  });

  it("passes empty thread when no messages", async () => {
    mockSupabaseData["chat_messages"] = { data: [], error: null };

    await renderPage();

    const props = mockClientComponent.mock.calls[0][0];
    expect(props.initialData.hasMore).toBe(false);
    expect(props.initialData.thread.messages).toHaveLength(0);
  });
});
