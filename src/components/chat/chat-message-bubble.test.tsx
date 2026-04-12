import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMessageBubble } from "./chat-message-bubble";
import type { ChatMessageWithSender, UserProfile } from "@/types";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

const sender: UserProfile = {
  id: "user-2",
  handle: "bob",
  name: "Bob Santos",
  avatarUrl: undefined,
};

function makeMessage(
  overrides: Partial<ChatMessageWithSender> = {},
): ChatMessageWithSender {
  return {
    id: "msg-1",
    groupId: "group-1",
    senderId: "user-2",
    messageType: "text",
    content: "Oi, tudo bem?",
    createdAt: "2026-04-12T14:30:00Z",
    sender,
    ...overrides,
  };
}

describe("ChatMessageBubble", () => {
  it("renders message content", () => {
    render(<ChatMessageBubble message={makeMessage()} isOwn={false} />);

    expect(screen.getByText("Oi, tudo bem?")).toBeInTheDocument();
  });

  it("renders timestamp", () => {
    render(<ChatMessageBubble message={makeMessage()} isOwn={false} />);

    // The time display depends on locale/timezone; just check something renders
    const timeElements = screen.getAllByText(/\d{2}:\d{2}/);
    expect(timeElements.length).toBeGreaterThan(0);
  });

  it("shows sender avatar for non-own messages", () => {
    render(<ChatMessageBubble message={makeMessage()} isOwn={false} />);

    // Avatar shows initials "BS" for Bob Santos
    expect(screen.getByText("BS")).toBeInTheDocument();
  });

  it("does not show avatar for own messages", () => {
    render(<ChatMessageBubble message={makeMessage()} isOwn={true} />);

    expect(screen.queryByText("BS")).not.toBeInTheDocument();
  });

  it("applies primary background for own messages", () => {
    const { container } = render(
      <ChatMessageBubble message={makeMessage()} isOwn={true} />,
    );

    const bubble = container.querySelector(".bg-primary");
    expect(bubble).toBeInTheDocument();
  });

  it("applies muted background for other messages", () => {
    const { container } = render(
      <ChatMessageBubble message={makeMessage()} isOwn={false} />,
    );

    const bubble = container.querySelector(".bg-muted");
    expect(bubble).toBeInTheDocument();
  });
});
