import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatMessageBubble } from "./chat-message-bubble";
import type { ChatMessage, UserProfile } from "@/types/ledger";

process.env.TZ = "UTC";

const sender: UserProfile = {
  id: "user-1",
  handle: "alice",
  name: "Alice Silva",
  avatarUrl: null,
  isBot: false,
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
  it("renders the message with its send time inside the bubble", () => {
    render(<ChatMessageBubble message={makeMessage()} isOwn={false} />);
    expect(screen.getByText("Olá!")).toBeDefined();
    expect(screen.getByText("12:00").getAttribute("datetime")).toBe("2026-01-01T12:00:00Z");
  });
});
