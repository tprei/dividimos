import { describe, expect, it } from "vitest";
import { chatMessageRowToMessage } from "./chat-actions";
import type { Database } from "@/types/database";

type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];

describe("chatMessageRowToMessage", () => {
  const baseRow: ChatMessageRow = {
    id: "msg-1",
    group_id: "group-1",
    sender_id: "user-1",
    message_type: "text",
    content: "Olá!",
    expense_id: null,
    settlement_id: null,
    created_at: "2026-04-10T20:00:00Z",
  };

  it("maps a text message row correctly", () => {
    const result = chatMessageRowToMessage(baseRow);

    expect(result).toEqual({
      id: "msg-1",
      groupId: "group-1",
      senderId: "user-1",
      messageType: "text",
      content: "Olá!",
      expenseId: undefined,
      settlementId: undefined,
      createdAt: "2026-04-10T20:00:00Z",
    });
  });

  it("maps expense_id when present", () => {
    const row: ChatMessageRow = {
      ...baseRow,
      message_type: "system_expense",
      expense_id: "exp-1",
    };

    const result = chatMessageRowToMessage(row);
    expect(result.expenseId).toBe("exp-1");
    expect(result.messageType).toBe("system_expense");
  });

  it("maps settlement_id when present", () => {
    const row: ChatMessageRow = {
      ...baseRow,
      message_type: "system_settlement",
      settlement_id: "set-1",
    };

    const result = chatMessageRowToMessage(row);
    expect(result.settlementId).toBe("set-1");
    expect(result.messageType).toBe("system_settlement");
  });

  it("converts null expense_id to undefined", () => {
    const result = chatMessageRowToMessage(baseRow);
    expect(result.expenseId).toBeUndefined();
  });

  it("converts null settlement_id to undefined", () => {
    const result = chatMessageRowToMessage(baseRow);
    expect(result.settlementId).toBeUndefined();
  });
});
