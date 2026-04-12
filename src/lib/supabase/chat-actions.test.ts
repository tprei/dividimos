import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSingle = vi.fn();
const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });
const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: mockFrom,
    auth: { getUser: mockGetUser },
  }),
}));

describe("sendChatMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });
  });

  it("returns error for empty content", async () => {
    const { sendChatMessage } = await import("./chat-actions");
    const result = await sendChatMessage("group-1", "   ");
    expect(result).toEqual({ error: "Mensagem vazia" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns error when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { sendChatMessage } = await import("./chat-actions");
    const result = await sendChatMessage("group-1", "Olá");
    expect(result).toEqual({ error: "Não autenticado" });
  });

  it("inserts a text message and returns mapped result", async () => {
    const row = {
      id: "msg-1",
      group_id: "group-1",
      sender_id: "user-1",
      message_type: "text" as const,
      content: "Olá",
      expense_id: null,
      settlement_id: null,
      created_at: "2026-04-12T00:00:00Z",
    };
    mockSingle.mockResolvedValue({ data: row, error: null });

    const { sendChatMessage } = await import("./chat-actions");
    const result = await sendChatMessage("group-1", "  Olá  ");

    expect(mockFrom).toHaveBeenCalledWith("chat_messages");
    expect(mockInsert).toHaveBeenCalledWith({
      group_id: "group-1",
      sender_id: "user-1",
      message_type: "text",
      content: "Olá",
    });

    expect(result).toEqual({
      id: "msg-1",
      groupId: "group-1",
      senderId: "user-1",
      messageType: "text",
      content: "Olá",
      expenseId: undefined,
      settlementId: undefined,
      createdAt: "2026-04-12T00:00:00Z",
    });
  });

  it("returns error when insert fails", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { message: "RLS violation" },
    });

    const { sendChatMessage } = await import("./chat-actions");
    const result = await sendChatMessage("group-1", "Olá");
    expect(result).toEqual({ error: "RLS violation" });
  });
});
