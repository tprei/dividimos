import { describe, it, expect } from "vitest";
import type {
  ChatMessage,
  ChatMessageType,
  ChatMessageWithSender,
  Group,
} from "./index";
import type { Database } from "./database";

type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];
type ChatMessageInsert = Database["public"]["Tables"]["chat_messages"]["Insert"];
type GroupRow = Database["public"]["Tables"]["groups"]["Row"];

describe("ChatMessage types", () => {
  it("ChatMessageType covers all enum values", () => {
    const types: ChatMessageType[] = [
      "text",
      "system_expense",
      "system_settlement",
    ];
    expect(types).toHaveLength(3);
  });

  it("ChatMessage interface matches expected shape", () => {
    const msg: ChatMessage = {
      id: "msg-1",
      groupId: "group-1",
      senderId: "user-1",
      messageType: "text",
      content: "Hello",
      createdAt: "2026-04-11T00:00:00Z",
    };

    expect(msg.id).toBe("msg-1");
    expect(msg.messageType).toBe("text");
    expect(msg.expenseId).toBeUndefined();
    expect(msg.settlementId).toBeUndefined();
  });

  it("ChatMessage supports system_expense with expense reference", () => {
    const msg: ChatMessage = {
      id: "msg-2",
      groupId: "group-1",
      senderId: "user-1",
      messageType: "system_expense",
      content: "Nova conta criada: Uber R$25,00",
      expenseId: "expense-1",
      createdAt: "2026-04-11T00:00:00Z",
    };

    expect(msg.messageType).toBe("system_expense");
    expect(msg.expenseId).toBe("expense-1");
  });

  it("ChatMessage supports system_settlement with settlement reference", () => {
    const msg: ChatMessage = {
      id: "msg-3",
      groupId: "group-1",
      senderId: "user-1",
      messageType: "system_settlement",
      content: "Pagamento de R$12,50 registrado",
      settlementId: "settlement-1",
      createdAt: "2026-04-11T00:00:00Z",
    };

    expect(msg.messageType).toBe("system_settlement");
    expect(msg.settlementId).toBe("settlement-1");
  });

  it("ChatMessageWithSender extends ChatMessage with sender profile", () => {
    const msg: ChatMessageWithSender = {
      id: "msg-4",
      groupId: "group-1",
      senderId: "user-1",
      messageType: "text",
      content: "Oi!",
      createdAt: "2026-04-11T00:00:00Z",
      sender: {
        id: "user-1",
        handle: "alice",
        name: "Alice",
        avatarUrl: "https://example.com/alice.jpg",
      },
    };

    expect(msg.sender.handle).toBe("alice");
  });
});

describe("Group isDm field", () => {
  it("Group interface includes isDm boolean", () => {
    const group: Group = {
      id: "group-1",
      name: "DM: Alice & Bob",
      creatorId: "user-1",
      isDm: true,
      createdAt: "2026-04-11T00:00:00Z",
    };

    expect(group.isDm).toBe(true);
  });

  it("Group isDm defaults conceptually to false for regular groups", () => {
    const group: Group = {
      id: "group-2",
      name: "Apartamento",
      creatorId: "user-1",
      isDm: false,
      createdAt: "2026-04-11T00:00:00Z",
    };

    expect(group.isDm).toBe(false);
  });
});

describe("Database types for chat_messages", () => {
  it("Row type has all required fields", () => {
    const row: ChatMessageRow = {
      id: "msg-1",
      group_id: "group-1",
      sender_id: "user-1",
      message_type: "text",
      content: "test",
      expense_id: null,
      settlement_id: null,
      created_at: "2026-04-11T00:00:00Z",
    };

    expect(row.message_type).toBe("text");
    expect(row.expense_id).toBeNull();
  });

  it("Insert type makes optional fields optional", () => {
    const insert: ChatMessageInsert = {
      group_id: "group-1",
      sender_id: "user-1",
    };

    expect(insert.group_id).toBe("group-1");
    expect(insert.message_type).toBeUndefined();
    expect(insert.content).toBeUndefined();
  });

  it("GroupRow includes is_dm field", () => {
    const row: GroupRow = {
      id: "group-1",
      name: "Test",
      creator_id: "user-1",
      is_dm: false,
      created_at: "2026-04-11T00:00:00Z",
    };

    expect(row.is_dm).toBe(false);
  });
});
