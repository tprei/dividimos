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
  it("renders message content without an in-bubble timestamp", () => {
    const { container } = render(<ChatMessageBubble message={makeMessage()} isOwn={false} />);
    expect(screen.getByText("Olá!")).toBeDefined();
    expect(container.textContent).not.toContain("12:00");
  });

  it("aligns own bubbles right with primary styling", () => {
    const { container } = render(<ChatMessageBubble message={makeMessage()} isOwn />);
    const bubble = container.firstElementChild?.firstElementChild;
    expect(bubble?.className).toContain("ml-auto");
    expect(bubble?.className).toContain("rounded-br-md");
    expect(bubble?.className).toContain("bg-primary");
  });

  it("aligns other people's bubbles left with muted styling", () => {
    const { container } = render(<ChatMessageBubble message={makeMessage()} isOwn={false} />);
    const bubble = container.firstElementChild?.firstElementChild;
    expect(bubble?.className).not.toContain("ml-auto");
    expect(bubble?.className).toContain("rounded-bl-md");
    expect(bubble?.className).toContain("bg-muted");
  });
});
