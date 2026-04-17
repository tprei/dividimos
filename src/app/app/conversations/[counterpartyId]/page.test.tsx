import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { Suspense } from "react";
import type { ConversationThread } from "@/lib/supabase/chat-actions";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock DM actions
const mockGetOrCreateDmGroup = vi.fn();
vi.mock("@/lib/supabase/dm-actions", () => ({
  getOrCreateDmGroup: (...args: unknown[]) => mockGetOrCreateDmGroup(...args),
}));

// Mock chat-actions
const mockLoadConversationMessages = vi.fn();
vi.mock("@/lib/supabase/chat-actions", () => ({
  loadConversationMessages: (...args: unknown[]) => mockLoadConversationMessages(...args),
  sendChatMessage: vi.fn(),
}));

// Mock chat-draft-confirm
vi.mock("@/lib/supabase/chat-draft-confirm", () => ({
  confirmChatDraft: vi.fn(),
}));

// Mock push notifications
vi.mock("@/lib/push/push-notify", () => ({
  notifyDmTextMessage: vi.fn().mockResolvedValue(undefined),
  notifyExpenseActivated: vi.fn().mockResolvedValue(undefined),
}));

// Mock markConversationRead
const mockMarkConversationRead = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/supabase/unread-actions", () => ({
  markConversationRead: (...args: unknown[]) => mockMarkConversationRead(...args),
}));

// Build a chainable Supabase mock
function chainable(resolveValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "select", "eq", "neq", "in", "is", "order", "limit", "single", "maybeSingle", "insert", "delete", "update", "rpc"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(resolveValue);
  return chain;
}

const mockSupabaseData: Record<string, { data: unknown; error: unknown }> = {};

function createMockSupabase() {
  const fromMock = vi.fn((table: string) => {
    const result = mockSupabaseData[table] ?? { data: [], error: null };
    return chainable(result);
  });

  return {
    from: fromMock,
    rpc: vi.fn(() => chainable({ data: null, error: null })),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: vi.fn(),
  };
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => createMockSupabase(),
}));

// Stable user reference to avoid infinite re-renders
const stableUser = {
  id: "user-1",
  name: "Alice Test",
  email: "alice@test.com",
  handle: "alice",
  avatarUrl: null,
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: stableUser }),
}));

// Mock realtime chat hook
vi.mock("@/hooks/use-realtime-chat", () => ({
  useRealtimeChat: vi.fn(),
}));

// Mock react-hot-toast
vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Mock framer-motion
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => <div {...props}>{children}</div>,
  },
}));

// Mock child components to simplify
vi.mock("@/components/chat/conversation-header", () => ({
  ConversationHeader: ({ counterparty }: { counterparty: { name: string } }) => (
    <div data-testid="conversation-header">{counterparty.name}</div>
  ),
}));
vi.mock("@/components/chat/conversation-pay-button", () => ({
  ConversationPayButton: () => <div data-testid="pay-button" />,
}));
vi.mock("@/components/chat/conversation-quick-actions", () => ({
  ConversationQuickActions: () => <div data-testid="quick-actions" />,
}));
vi.mock("@/components/chat/quick-charge-sheet", () => ({
  QuickChargeSheet: () => null,
}));
vi.mock("@/components/chat/quick-split-sheet", () => ({
  QuickSplitSheet: () => null,
}));
vi.mock("@/components/chat/chat-thread", () => ({
  ChatThread: () => <div data-testid="chat-thread" />,
}));
vi.mock("@/components/chat/chat-ai-input", () => ({
  ChatAiInput: () => <div data-testid="chat-input" />,
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

const emptyThread: ConversationThread = {
  messages: [],
  expenses: new Map(),
  settlements: new Map(),
  profiles: new Map(),
};

describe("ConversationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabaseData["user_profiles"] = {
      data: {
        id: "user-2",
        handle: "bob",
        name: "Bob Test",
        avatar_url: null,
      },
      error: null,
    };
    mockSupabaseData["group_members"] = {
      data: [
        { user_id: "user-1", status: "accepted" },
        { user_id: "user-2", status: "accepted" },
      ],
      error: null,
    };

    mockGetOrCreateDmGroup.mockResolvedValue({ groupId: "dm-group-1" });
    mockLoadConversationMessages.mockResolvedValue(emptyThread);
  });

  it("renders conversation after loading", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("conversation-header")).toHaveTextContent("Bob Test");
    });
    expect(screen.getByTestId("chat-thread")).toBeInTheDocument();
  });

  it("creates DM group before fetching profile (RLS dependency)", async () => {
    const callOrder: string[] = [];

    mockGetOrCreateDmGroup.mockImplementation(() => {
      callOrder.push("dm");
      return Promise.resolve({ groupId: "dm-group-1" });
    });

    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("conversation-header")).toBeInTheDocument();
    });

    expect(mockGetOrCreateDmGroup).toHaveBeenCalledWith("user-2");
    expect(callOrder).toContain("dm");
  });

  it("fires markConversationRead as fire-and-forget", async () => {
    let markReadResolved = false;
    mockMarkConversationRead.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            markReadResolved = true;
            resolve();
          }, 10000);
        }),
    );

    await renderPage();

    // Page should render fully even though markConversationRead hasn't resolved
    await waitFor(() => {
      expect(screen.getByTestId("chat-thread")).toBeInTheDocument();
    });

    // markConversationRead was called
    expect(mockMarkConversationRead).toHaveBeenCalled();
    // But it hasn't resolved — page rendered without waiting
    expect(markReadResolved).toBe(false);
  });

  it("shows error when DM group creation fails", async () => {
    mockGetOrCreateDmGroup.mockResolvedValue({
      error: "Grupo não encontrado",
      code: "not_found",
    });

    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Grupo não encontrado")).toBeInTheDocument();
    });
  });

  it("shows error when counterparty profile not found", async () => {
    mockSupabaseData["user_profiles"] = { data: null, error: { message: "not found" } };

    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Usuário não encontrado")).toBeInTheDocument();
    });
  });
});
