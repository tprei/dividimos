import { describe, expect, it } from "vitest";
import { chatMessageRowToChatMessage } from "./chat-actions";

describe("chatMessageRowToChatMessage", () => {
  it("maps a full chat message row to domain type", () => {
    const row = {
      id: "msg-1",
      group_id: "group-1",
      sender_id: "user-1",
      message_type: "text" as const,
      content: "Hello!",
      expense_id: null,
      settlement_id: null,
      created_at: "2026-04-12T14:00:00Z",
    };

    const result = chatMessageRowToChatMessage(row);

    expect(result).toEqual({
      id: "msg-1",
      groupId: "group-1",
      senderId: "user-1",
      messageType: "text",
      content: "Hello!",
      expenseId: undefined,
      settlementId: undefined,
      createdAt: "2026-04-12T14:00:00Z",
    });
  });

  it("maps expense_id and settlement_id when present", () => {
    const row = {
      id: "msg-2",
      group_id: "group-1",
      sender_id: "user-1",
      message_type: "system_expense" as const,
      content: "",
      expense_id: "exp-1",
      settlement_id: null,
      created_at: "2026-04-12T15:00:00Z",
    };

    const result = chatMessageRowToChatMessage(row);

    expect(result.expenseId).toBe("exp-1");
    expect(result.settlementId).toBeUndefined();
  });

  it("maps settlement message type correctly", () => {
    const row = {
      id: "msg-3",
      group_id: "group-1",
      sender_id: "user-2",
      message_type: "system_settlement" as const,
      content: "",
      expense_id: null,
      settlement_id: "set-1",
      created_at: "2026-04-12T16:00:00Z",
    };

    const result = chatMessageRowToChatMessage(row);

    expect(result.messageType).toBe("system_settlement");
    expect(result.settlementId).toBe("set-1");
  });
});
