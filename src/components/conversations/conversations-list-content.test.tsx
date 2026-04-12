import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
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

  it("links to conversation thread via counterparty id", () => {
    const conversations = [
      makeConversation({ counterparty: { id: "user-2", handle: "maria", name: "Maria Silva" } }),
    ];

    render(
      <ConversationsListContent initialConversations={conversations} />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/app/conversations/user-2",
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

  describe("search", () => {
    const conversations = [
      makeConversation({
        groupId: "dm-1",
        counterparty: { id: "u2", handle: "maria", name: "Maria Silva" },
        lastMessageContent: "Oi, tudo bem?",
        lastMessageAt: new Date().toISOString(),
      }),
      makeConversation({
        groupId: "dm-2",
        counterparty: { id: "u3", handle: "joao", name: "João Santos" },
        lastMessageContent: "Vamos dividir a conta",
        lastMessageAt: new Date().toISOString(),
      }),
      makeConversation({
        groupId: "dm-3",
        counterparty: { id: "u4", handle: "ana_luz", name: "Ana Luz" },
        lastMessageContent: null,
        lastMessageAt: null,
      }),
    ];

    it("shows search input when conversations exist", () => {
      render(
        <ConversationsListContent initialConversations={conversations} />,
      );
      expect(
        screen.getByPlaceholderText("Buscar por nome, @handle ou mensagem..."),
      ).toBeInTheDocument();
    });

    it("hides search input when no conversations", () => {
      render(<ConversationsListContent initialConversations={[]} />);
      expect(
        screen.queryByPlaceholderText("Buscar por nome, @handle ou mensagem..."),
      ).not.toBeInTheDocument();
    });

    it("filters by counterparty name", () => {
      render(
        <ConversationsListContent initialConversations={conversations} />,
      );

      const input = screen.getByPlaceholderText(
        "Buscar por nome, @handle ou mensagem...",
      );
      fireEvent.change(input, { target: { value: "Maria" } });

      expect(screen.getByText("Maria Silva")).toBeInTheDocument();
      expect(screen.queryByText("João Santos")).not.toBeInTheDocument();
      expect(screen.queryByText("Ana Luz")).not.toBeInTheDocument();
    });

    it("filters by counterparty handle", () => {
      render(
        <ConversationsListContent initialConversations={conversations} />,
      );

      const input = screen.getByPlaceholderText(
        "Buscar por nome, @handle ou mensagem...",
      );
      fireEvent.change(input, { target: { value: "joao" } });

      expect(screen.getByText("João Santos")).toBeInTheDocument();
      expect(screen.queryByText("Maria Silva")).not.toBeInTheDocument();
    });

    it("filters by last message content", () => {
      render(
        <ConversationsListContent initialConversations={conversations} />,
      );

      const input = screen.getByPlaceholderText(
        "Buscar por nome, @handle ou mensagem...",
      );
      fireEvent.change(input, { target: { value: "dividir" } });

      expect(screen.getByText("João Santos")).toBeInTheDocument();
      expect(screen.queryByText("Maria Silva")).not.toBeInTheDocument();
    });

    it("is case insensitive", () => {
      render(
        <ConversationsListContent initialConversations={conversations} />,
      );

      const input = screen.getByPlaceholderText(
        "Buscar por nome, @handle ou mensagem...",
      );
      fireEvent.change(input, { target: { value: "MARIA" } });

      expect(screen.getByText("Maria Silva")).toBeInTheDocument();
      expect(screen.queryByText("João Santos")).not.toBeInTheDocument();
    });

    it("shows empty state when no results match", () => {
      render(
        <ConversationsListContent initialConversations={conversations} />,
      );

      const input = screen.getByPlaceholderText(
        "Buscar por nome, @handle ou mensagem...",
      );
      fireEvent.change(input, { target: { value: "zzzzz" } });

      expect(screen.getByText("Nenhum resultado")).toBeInTheDocument();
    });

    it("does not filter with less than 2 characters", () => {
      render(
        <ConversationsListContent initialConversations={conversations} />,
      );

      const input = screen.getByPlaceholderText(
        "Buscar por nome, @handle ou mensagem...",
      );
      fireEvent.change(input, { target: { value: "M" } });

      expect(screen.getByText("Maria Silva")).toBeInTheDocument();
      expect(screen.getByText("João Santos")).toBeInTheDocument();
      expect(screen.getByText("Ana Luz")).toBeInTheDocument();
    });

    it("clears search when X button is clicked", () => {
      render(
        <ConversationsListContent initialConversations={conversations} />,
      );

      const input = screen.getByPlaceholderText(
        "Buscar por nome, @handle ou mensagem...",
      );
      fireEvent.change(input, { target: { value: "Maria" } });

      expect(screen.queryByText("João Santos")).not.toBeInTheDocument();

      const clearButton = screen.getByRole("button");
      fireEvent.click(clearButton);

      expect(screen.getByText("Maria Silva")).toBeInTheDocument();
      expect(screen.getByText("João Santos")).toBeInTheDocument();
      expect(screen.getByText("Ana Luz")).toBeInTheDocument();
    });
  });
});
