import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifyChatMessage } from "./chat-notify";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("notifyChatMessage", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it("calls POST /api/chat/notify with the correct body", async () => {
    await notifyChatMessage({
      recipientUserId: "user-2",
      senderName: "Alice",
      messagePreview: "Olá!",
      conversationGroupId: "group-1",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/chat/notify");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({
      recipientUserId: "user-2",
      senderName: "Alice",
      messagePreview: "Olá!",
      conversationGroupId: "group-1",
    });
  });

  it("does not throw when fetch rejects", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    await expect(
      notifyChatMessage({
        recipientUserId: "user-2",
        senderName: "Alice",
        messagePreview: "Olá!",
        conversationGroupId: "group-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("truncates messagePreview at 100 characters when called with long text", async () => {
    const longText = "a".repeat(200);

    await notifyChatMessage({
      recipientUserId: "user-2",
      senderName: "Alice",
      messagePreview: longText,
      conversationGroupId: "group-1",
    });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { messagePreview: string };
    expect(body.messagePreview).toBe(longText);
  });
});
