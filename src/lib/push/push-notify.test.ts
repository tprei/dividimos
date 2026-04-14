import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("./web-push", () => ({
  isWebPushConfigured: vi.fn(),
  sendPushNotification: vi.fn(),
}));

vi.mock("./fcm", () => ({
  isFcmConfigured: vi.fn().mockReturnValue(false),
  sendFcmNotification: vi.fn(),
}));

vi.mock("./notify-user", () => ({
  notifyUser: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isWebPushConfigured } from "./web-push";
import { notifyUser } from "./notify-user";
import {
  notifyGroupInvite,
  notifyGroupAccepted,
  notifyExpenseActivated,
  notifySettlementRecorded,
  notifyDmTextMessage,
  notifyPaymentNudge,
  notifyExpenseEdited,
  notifyExpenseDeleted,
} from "./push-notify";

function mockCaller(userId: string | null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: userId ? { id: userId } : null },
          error: null,
        }),
    },
  } as never);
}

// Helper to build a chainable Supabase mock
function mockSupabaseChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.from = vi.fn().mockReturnValue(chain);
  return chain;
}

describe("push-notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWebPushConfigured).mockReturnValue(true);
    vi.mocked(notifyUser).mockResolvedValue({ sent: 1, cleaned: 0 });
    mockCaller("caller-1");
  });

  describe("notifyGroupInvite", () => {
    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifyGroupInvite("group-1", "invitee-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is not authenticated", async () => {
      mockCaller(null);

      await notifyGroupInvite("group-1", "invitee-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is not a group member", async () => {
      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "group_members") {
          return {
            select: (_col: string, opts?: { count?: string }) => {
              if (opts?.count) {
                return {
                  eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 0 }) }) }),
                };
              }
              return {
                eq: () => ({
                  eq: () => ({
                    single: () =>
                      Promise.resolve({ data: null, error: null }),
                  }),
                }),
              };
            },
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyGroupInvite("group-1", "invitee-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("sends notification to invitee with group name and inviter name", async () => {
      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "Almoço" }, error: null }),
              }),
            }),
          };
        }
        if (table === "group_members") {
          return {
            select: (_col: string, opts?: { count?: string }) => {
              if (opts?.count) {
                return {
                  eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 1 }) }) }),
                };
              }
              return {
                eq: () => ({
                  eq: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { invited_by: "inviter-1" },
                        error: null,
                      }),
                  }),
                }),
              };
            },
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "João" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyGroupInvite("group-1", "invitee-1");

      expect(notifyUser).toHaveBeenCalledWith("invitee-1", {
        title: "Novo convite de grupo",
        body: 'João convidou você para "Almoço"',
        url: "/app/groups",
        tag: "group-invite-group-1",
      });
    });

    it("uses fallback names when DB returns null", async () => {
      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "group_members") {
          return {
            select: (_col: string, opts?: { count?: string }) => {
              if (opts?.count) {
                return {
                  eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 1 }) }) }),
                };
              }
              return {
                eq: () => ({
                  eq: () => ({
                    single: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
              };
            },
          };
        }
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              eq: () => ({
                single: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        };
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyGroupInvite("group-1", "invitee-1");

      expect(notifyUser).toHaveBeenCalledWith("invitee-1", {
        title: "Novo convite de grupo",
        body: 'Alguém convidou você para "um grupo"',
        url: "/app/groups",
        tag: "group-invite-group-1",
      });
    });

    it("notifies the invitee when caller is the group creator (not in group_members)", async () => {
      // Creators have no row in group_members. The check must also accept
      // groups.creator_id === callerId, otherwise invites from the creator
      // silently fail.
      mockCaller("creator-1");
      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "Viagem", creator_id: "creator-1" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "group_members") {
          return {
            select: (_col: string, opts?: { count?: string }) => {
              if (opts?.count) {
                return {
                  eq: () => ({
                    eq: () => ({
                      eq: () => Promise.resolve({ count: 0 }),
                    }),
                  }),
                };
              }
              return {
                eq: () => ({
                  eq: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { invited_by: "creator-1" },
                        error: null,
                      }),
                  }),
                }),
              };
            },
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "Thiago" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyGroupInvite("group-1", "invitee-1");

      expect(notifyUser).toHaveBeenCalledWith("invitee-1", {
        title: "Novo convite de grupo",
        body: 'Thiago convidou você para "Viagem"',
        url: "/app/groups",
        tag: "group-invite-group-1",
      });
    });
  });

  describe("notifyGroupAccepted", () => {
    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifyGroupAccepted("group-1", "accepter-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller does not match accepterId", async () => {
      mockCaller("different-user");

      await notifyGroupAccepted("group-1", "accepter-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("notifies the inviter when invite is accepted", async () => {
      mockCaller("accepter-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "Viagem" }, error: null }),
              }),
            }),
          };
        }
        if (table === "group_members") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { invited_by: "inviter-1" },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "Maria" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyGroupAccepted("group-1", "accepter-1");

      expect(notifyUser).toHaveBeenCalledWith("inviter-1", {
        title: "Convite aceito",
        body: 'Maria entrou em "Viagem"',
        url: "/app/groups/group-1",
        tag: "group-accepted-group-1",
      });
    });

    it("skips notification when accepter is also the inviter", async () => {
      mockCaller("same-user");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "Test" }, error: null }),
              }),
            }),
          };
        }
        if (table === "group_members") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { invited_by: "same-user" },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "Self" }, error: null }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyGroupAccepted("group-1", "same-user");

      expect(notifyUser).not.toHaveBeenCalled();
    });
  });

  describe("notifyExpenseActivated", () => {
    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifyExpenseActivated("expense-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is not the expense creator", async () => {
      mockCaller("not-the-creator");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "expenses") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      group_id: "group-1",
                      creator_id: "creator-1",
                      title: "Pizza",
                      total_amount: 5000,
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "expense_shares") {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ user_id: "creator-1" }, { user_id: "user-2" }],
                  error: null,
                }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyExpenseActivated("expense-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("notifies affected users excluding creator", async () => {
      mockCaller("creator-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "expenses") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      group_id: "group-1",
                      creator_id: "creator-1",
                      title: "Pizza",
                      total_amount: 5000,
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "expense_shares") {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    { user_id: "creator-1" },
                    { user_id: "user-2" },
                    { user_id: "user-3" },
                  ],
                  error: null,
                }),
            }),
          };
        }
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "Amigos" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "Carlos" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyExpenseActivated("expense-1");

      expect(notifyUser).toHaveBeenCalledTimes(2);
      expect(notifyUser).toHaveBeenCalledWith("user-2", {
        title: 'Nova despesa em "Amigos"',
        body: 'Carlos adicionou "Pizza" — R$\u00a050,00',
        url: "/app/bill/expense-1",
        tag: "expense-expense-1",
      });
      expect(notifyUser).toHaveBeenCalledWith("user-3", expect.objectContaining({
        title: 'Nova despesa em "Amigos"',
      }));
    });

    it("skips when expense is not found", async () => {
      mockCaller("creator-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "expenses") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === "expense_shares") {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyExpenseActivated("expense-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("omits group name and deep-links to the conversation in a DM", async () => {
      // DM groups have no meaningful `name` — using it verbatim produced
      // titles like 'Nova despesa em ""'. For DMs we should omit the group
      // part and deep-link to /app/conversations/<creator> instead.
      mockCaller("creator-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "expenses") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      group_id: "dm-group-1",
                      creator_id: "creator-1",
                      title: "Almoço",
                      total_amount: 4500,
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "expense_shares") {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    { user_id: "creator-1" },
                    { user_id: "counterparty-1" },
                  ],
                  error: null,
                }),
            }),
          };
        }
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "", is_dm: true },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "dm_pairs") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { user_a: "creator-1", user_b: "counterparty-1" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "Carlos" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyExpenseActivated("expense-1");

      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith("counterparty-1", {
        title: "Nova despesa",
        body: 'Carlos adicionou "Almoço" — R$\u00a045,00',
        url: "/app/conversations/creator-1",
        tag: "expense-expense-1",
      });
    });
  });

  describe("notifySettlementRecorded", () => {
    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifySettlementRecorded("group-1", "from-1", "to-1", 2500);

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller does not match fromUserId", async () => {
      mockCaller("different-user");

      await notifySettlementRecorded("group-1", "from-1", "to-1", 2500);

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("notifies the creditor with settlement details", async () => {
      mockCaller("from-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "Casa" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "Ana" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifySettlementRecorded("group-1", "from-1", "to-1", 2500);

      expect(notifyUser).toHaveBeenCalledWith("to-1", {
        title: "Pagamento registrado",
        body: 'Ana pagou R$\u00a025,00 em "Casa"',
        url: "/app/groups/group-1",
        tag: "settlement-group-1",
      });
    });

    it("swallows errors from notifyUser", async () => {
      mockCaller("from-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "G" }, error: null }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "X" }, error: null }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);
      vi.mocked(notifyUser).mockRejectedValue(new Error("push failed"));

      await expect(
        notifySettlementRecorded("group-1", "from-1", "to-1", 1000),
      ).resolves.toBeUndefined();
    });
  });

  describe("notifyDmTextMessage", () => {
    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifyDmTextMessage("group-1", "Oi!");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is not authenticated", async () => {
      mockCaller(null);

      await notifyDmTextMessage("group-1", "Oi!");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when dm_pairs row is not found", async () => {
      const chain = mockSupabaseChain({ data: null, error: null });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyDmTextMessage("group-1", "Oi!");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("notifies counterparty (user_b) when sender is user_a", async () => {
      mockCaller("user-a");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "dm_pairs") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { user_a: "user-a", user_b: "user-b" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "Alice" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyDmTextMessage("group-1", "Oi, tudo bem?");

      expect(notifyUser).toHaveBeenCalledWith("user-b", {
        title: "Alice",
        body: "Oi, tudo bem?",
        url: "/app/conversations/user-a",
        tag: "dm-group-1",
      });
    });

    it("notifies counterparty (user_a) when sender is user_b", async () => {
      mockCaller("user-b");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "dm_pairs") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { user_a: "user-a", user_b: "user-b" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "Bob" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyDmTextMessage("group-1", "Vamos dividir?");

      expect(notifyUser).toHaveBeenCalledWith("user-a", {
        title: "Bob",
        body: "Vamos dividir?",
        url: "/app/conversations/user-b",
        tag: "dm-group-1",
      });
    });

    it("truncates long messages to 80 characters", async () => {
      mockCaller("user-a");

      const longMessage = "A".repeat(100);

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "dm_pairs") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { user_a: "user-a", user_b: "user-b" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { name: "Alice" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyDmTextMessage("group-1", longMessage);

      expect(notifyUser).toHaveBeenCalledWith("user-b", expect.objectContaining({
        body: "A".repeat(77) + "…",
      }));
    });

    it("uses fallback name when sender profile not found", async () => {
      mockCaller("user-a");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "dm_pairs") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { user_a: "user-a", user_b: "user-b" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: null, error: null }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyDmTextMessage("group-1", "Oi!");

      expect(notifyUser).toHaveBeenCalledWith("user-b", expect.objectContaining({
        title: "Alguém",
      }));
    });

    it("swallows errors from notifyUser", async () => {
      mockCaller("user-a");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "dm_pairs") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { user_a: "user-a", user_b: "user-b" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "X" }, error: null }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);
      vi.mocked(notifyUser).mockRejectedValue(new Error("push failed"));

      await expect(
        notifyDmTextMessage("group-1", "Oi!"),
      ).resolves.toBeUndefined();
    });
  });

  describe("notifyPaymentNudge", () => {
    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifyPaymentNudge("group-1", "debtor-1", 5000);

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is the debtor (cannot nudge yourself)", async () => {
      mockCaller("debtor-1");

      await notifyPaymentNudge("group-1", "debtor-1", 5000);

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is not authenticated", async () => {
      mockCaller(null);

      await notifyPaymentNudge("group-1", "debtor-1", 5000);

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("notifies debtor with creditor name and amount", async () => {
      mockCaller("creditor-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "Viagem" }, error: null }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "João" }, error: null }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyPaymentNudge("group-1", "debtor-1", 5000);

      expect(notifyUser).toHaveBeenCalledWith("debtor-1", {
        title: "Lembrete de pagamento",
        body: 'João pediu R$\u00a050,00 em "Viagem"',
        url: "/app/groups/group-1",
        tag: "nudge-group-1-creditor-1",
      });
    });

    it("uses fallback names when DB returns null", async () => {
      mockCaller("creditor-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }));
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyPaymentNudge("group-1", "debtor-1", 2500);

      expect(notifyUser).toHaveBeenCalledWith("debtor-1", {
        title: "Lembrete de pagamento",
        body: 'Alguém pediu R$\u00a025,00 em "um grupo"',
        url: "/app/groups/group-1",
        tag: "nudge-group-1-creditor-1",
      });
    });
  });

  describe("notifyExpenseEdited", () => {
    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifyExpenseEdited("exp-1", "group-1", "Pizza", ["user-2"]);

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is not authenticated", async () => {
      mockCaller(null);

      await notifyExpenseEdited("exp-1", "group-1", "Pizza", ["user-2"]);

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("notifies affected users excluding the editor", async () => {
      mockCaller("editor-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "Amigos" }, error: null }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "Carlos" }, error: null }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyExpenseEdited("exp-1", "group-1", "Pizza", [
        "editor-1",
        "user-2",
        "user-3",
      ]);

      expect(notifyUser).toHaveBeenCalledTimes(2);
      expect(notifyUser).toHaveBeenCalledWith("user-2", {
        title: 'Despesa editada em "Amigos"',
        body: 'Carlos editou "Pizza"',
        url: "/app/bill/exp-1",
        tag: "expense-edited-exp-1",
      });
      expect(notifyUser).toHaveBeenCalledWith("user-3", expect.objectContaining({
        title: 'Despesa editada em "Amigos"',
      }));
    });
  });

  describe("notifyExpenseDeleted", () => {
    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifyExpenseDeleted("group-1", "Pizza", ["user-2"]);

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is not authenticated", async () => {
      mockCaller(null);

      await notifyExpenseDeleted("group-1", "Pizza", ["user-2"]);

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("notifies affected users excluding the deleter", async () => {
      mockCaller("deleter-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "Casa" }, error: null }),
              }),
            }),
          };
        }
        if (table === "user_profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: { name: "Ana" }, error: null }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyExpenseDeleted("group-1", "Almoço", [
        "deleter-1",
        "user-2",
      ]);

      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith("user-2", {
        title: 'Despesa removida em "Casa"',
        body: 'Ana removeu "Almoço"',
        url: "/app/groups/group-1",
        tag: "expense-deleted-group-1",
      });
    });

    it("uses fallback names when DB returns null", async () => {
      mockCaller("deleter-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }));
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyExpenseDeleted("group-1", "Pizza", [
        "deleter-1",
        "user-2",
      ]);

      expect(notifyUser).toHaveBeenCalledWith("user-2", {
        title: 'Despesa removida em "um grupo"',
        body: 'Alguém removeu "Pizza"',
        url: "/app/groups/group-1",
        tag: "expense-deleted-group-1",
      });
    });
  });
});
