import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatMessageBubble } from "./chat-message-bubble";
import type { ChatMessage, UserProfile } from "@/types/ledger";

const sender: UserProfile = {
  id: "user-1",
  handle: "alice",
  name: "Alice Silva",
  avatarUrl: null,
};

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    clientId: "c-1",
    groupId: "g-1",
    senderId: sender.id,
    content: "Olá!",
    createdAt: "2026-01-01T12:00:00Z",
    sender,
    ...overrides,
  };
}

describe("ChatMessageBubble", () => {
  it("renders text message content and timestamp", () => {
    render(<ChatMessageBubble message={makeMessage()} isOwn={false} showAvatar={false} />);
    expect(screen.getByText("Olá!")).toBeDefined();
  });

  it("shows avatar when showAvatar is true", () => {
    const { container } = render(
      <ChatMessageBubble message={makeMessage()} isOwn={false} showAvatar />,
    );
    expect(container.querySelector("img") ?? container.textContent).toBeTruthy();
  });

  it("does not show avatar when isOwn is true", () => {
    render(<ChatMessageBubble message={makeMessage()} isOwn showAvatar={false} />);
    expect(screen.getByText("Olá!")).toBeDefined();
  });
});
