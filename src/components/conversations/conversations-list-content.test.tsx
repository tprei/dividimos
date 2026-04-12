import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ConversationsListContent,
  type ConversationEntry,
} from "./conversations-list-content";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useUser: () => ({ id: "user-1", name: "Test User" }),
}));

function makeConversation(
  overrides: Partial<ConversationEntry> = {},
): ConversationEntry {
  return {
    groupId: overrides.groupId ?? "dm-group-1",
    counterparty: overrides.counterparty ?? {
      id: "user-2",
      handle: "maria",
      name: "Maria Silva",
    },
    lastMessageContent: overrides.lastMessageContent ?? null,
    lastMessageAt: overrides.lastMessageAt ?? null,
    netBalanceCents: overrides.netBalanceCents ?? 0,
    unreadCount: overrides.unreadCount ?? 0,
  };
}

describe("ConversationsListContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state when no conversations", () => {
    render(<ConversationsListContent initialConversations={[]} />);

    expect(screen.getByText("Nenhuma conversa")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Conversas aparecem quando você divide contas diretamente com alguém.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Nenhuma conversa ainda")).toBeInTheDocument();
  });

  it("renders conversation list with counterparty names", () => {
    const conversations = [
      makeConversation({
        groupId: "dm-1",
        counterparty: { id: "u2", handle: "maria", name: "Maria Silva" },
      }),
      makeConversation({
        groupId: "dm-2",
        counterparty: { id: "u3", handle: "joao", name: "João Santos" },
      }),
    ];

    render(
      <ConversationsListContent initialConversations={conversations} />,
    );

    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getByText("João Santos")).toBeInTheDocument();
    expect(screen.getByText("2 conversas")).toBeInTheDocument();
  });

  it("shows singular count for one conversation", () => {
    render(
      <ConversationsListContent
        initialConversations={[makeConversation()]}
      />,
    );
    expect(screen.getByText("1 conversa")).toBeInTheDocument();
  });

  it("displays last message content", () => {
    const conversations = [
      makeConversation({
        lastMessageContent: "Oi, vamos dividir a conta?",
        lastMessageAt: new Date().toISOString(),
      }),
    ];

    render(
      <ConversationsListContent initialConversations={conversations} />,
    );

    expect(
      screen.getByText("Oi, vamos dividir a conta?"),
    ).toBeInTheDocument();
  });

  it("shows 'Sem mensagens' when no last message", () => {
    render(
      <ConversationsListContent
        initialConversations={[makeConversation()]}
      />,
    );

    expect(screen.getByText("Sem mensagens")).toBeInTheDocument();
  });

  it("shows positive balance in green", () => {
    const conversations = [
      makeConversation({ netBalanceCents: 2500 }),
    ];

    render(
      <ConversationsListContent initialConversations={conversations} />,
    );

    const balanceEl = screen.getByText("+R$ 25,00");
    expect(balanceEl).toBeInTheDocument();
    expect(balanceEl.className).toContain("text-emerald");
  });

  it("shows negative balance in red", () => {
    const conversations = [
      makeConversation({ netBalanceCents: -1500 }),
    ];

    render(
      <ConversationsListContent initialConversations={conversations} />,
    );

    const balanceEl = screen.getByText("-R$ 15,00");
    expect(balanceEl).toBeInTheDocument();
    expect(balanceEl.className).toContain("text-red");
  });

  it("hides balance when zero", () => {
    render(
      <ConversationsListContent
        initialConversations={[makeConversation({ netBalanceCents: 0 })]}
      />,
    );

    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
  });

  it("links to conversation thread", () => {
    const conversations = [
      makeConversation({ groupId: "dm-abc-123" }),
    ];

    render(
      <ConversationsListContent initialConversations={conversations} />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/app/conversations/dm-abc-123",
    );
  });

  it("shows unread badge when unreadCount > 0", () => {
    const conversations = [
      makeConversation({ unreadCount: 3 }),
    ];

    render(
      <ConversationsListContent initialConversations={conversations} />,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows 99+ for large unread counts", () => {
    const conversations = [
      makeConversation({ unreadCount: 150 }),
    ];

    render(
      <ConversationsListContent initialConversations={conversations} />,
    );

    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("does not show unread badge when count is 0", () => {
    const conversations = [
      makeConversation({ unreadCount: 0 }),
    ];

    render(
      <ConversationsListContent initialConversations={conversations} />,
    );

    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("applies bold styling to unread conversations", () => {
    const conversations = [
      makeConversation({
        unreadCount: 2,
        lastMessageContent: "Nova mensagem",
        lastMessageAt: new Date().toISOString(),
      }),
    ];

    render(
      <ConversationsListContent initialConversations={conversations} />,
    );

    const messageEl = screen.getByText("Nova mensagem");
    expect(messageEl.className).toContain("font-medium");
  });
});
