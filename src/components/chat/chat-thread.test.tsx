import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatThread, mergeTimeline } from "./chat-thread";
import type { ChatMessage, GroupEvent, UserProfile } from "@/types/ledger";

process.env.TZ = "UTC";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const meId = "user-1";
const bob: UserProfile = {
  id: "user-2",
  handle: "bob",
  name: "Bob Silva",
  avatarUrl: null,
  isBot: false,
};

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    clientId: "c-1",
    groupId: "g-1",
    senderId: bob.id,
    content: "Oi Alice",
    createdAt: "2026-01-01T12:00:00Z",
    sender: bob,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<GroupEvent> = {}): GroupEvent {
  return {
    id: 1,
    groupId: "g-1",
    actorId: bob.id,
    kind: "member_joined",
    expenseId: null,
    settlementId: null,
    subjectUserId: bob.id,
    payload: {},
    createdAt: "2026-01-01T10:00:00Z",
    actor: bob,
    expenseTitle: null,
    ...overrides,
  };
}

function renderThread(props: Partial<Parameters<typeof ChatThread>[0]> = {}) {
  return render(
    <ChatThread
      groupId="g-1"
      meId={meId}
      messages={[]}
      events={[]}
      settlements={[]}
      nameOf={() => "Bob Silva"}
      {...props}
    />,
  );
}

describe("mergeTimeline", () => {
  it("sorts by createdAt asc and puts events first on ties", () => {
    const msg: ChatMessage = makeMessage({ id: "m1", createdAt: "2026-01-01T10:00:00Z" });
    const ev: GroupEvent = makeEvent({ id: 1, createdAt: "2026-01-01T10:00:00Z" });
    const laterMsg: ChatMessage = makeMessage({ id: "m2", createdAt: "2026-01-01T11:00:00Z" });

    const merged = mergeTimeline([laterMsg, msg], [ev]);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toEqual({ kind: "event", at: "2026-01-01T10:00:00Z", event: ev });
    expect(merged[1]).toEqual({ kind: "message", at: "2026-01-01T10:00:00Z", message: msg });
    expect(merged[2]).toEqual({ kind: "message", at: "2026-01-01T11:00:00Z", message: laterMsg });
  });
});

describe("ChatThread", () => {
  it("renders empty state when there are no items", () => {
    renderThread();
    expect(screen.getByText("Nenhuma mensagem")).toBeDefined();
  });

  it("renders messages and events", () => {
    const msg = makeMessage({ content: "Oi tudo bem?" });
    const ev = makeEvent({ id: 2 });
    renderThread({ messages: [msg], events: [ev] });
    expect(screen.getByText("Oi tudo bem?")).toBeDefined();
    expect(screen.getByText("Bob Silva entrou no grupo")).toBeDefined();
  });
  it("shows each message time once, inside its bubble", () => {
    const first = makeMessage({ id: "m1", createdAt: "2026-01-01T12:00:00Z" });
    const second = makeMessage({ id: "m2", content: "Tudo certo", createdAt: "2026-01-01T12:01:00Z" });
    renderThread({ messages: [first, second] });
    expect(screen.getAllByText("12:00")).toHaveLength(1);
    expect(screen.getAllByText("12:01")).toHaveLength(1);
  });

  it("marks the start of a sender's run with their avatar and name once", () => {
    const first = makeMessage({ id: "m1", createdAt: "2026-01-01T12:00:00Z" });
    const second = makeMessage({ id: "m2", createdAt: "2026-01-01T12:01:00Z" });
    renderThread({ messages: [first, second] });
    expect(screen.getAllByText("BS")).toHaveLength(1);
    expect(screen.getAllByText("Bob")).toHaveLength(1);
  });

  it("shows the avatar again when messages are more than 5 minutes apart", () => {
    const first = makeMessage({ id: "m1", createdAt: "2026-01-01T12:00:00Z" });
    const second = makeMessage({ id: "m2", createdAt: "2026-01-01T12:06:00Z" });
    renderThread({ messages: [first, second] });
    expect(screen.getAllByText("BS")).toHaveLength(2);
  });

  it("omits sender names when the thread asks for it", () => {
    renderThread({ messages: [makeMessage()], showSenderNames: false });
    expect(screen.getByText("BS")).toBeDefined();
    expect(screen.queryByText("Bob")).toBeNull();
  });

  it("calls onLoadMore when clicking Carregar anteriores button", () => {
    const onLoadMore = vi.fn();
    const msg = makeMessage();
    renderThread({ messages: [msg], hasMore: true, onLoadMore });
    const btn = screen.getByTestId("chat-load-more");
    fireEvent.click(btn);
    expect(onLoadMore).toHaveBeenCalled();
  });
});
