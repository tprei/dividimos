import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("./web-push", () => ({
  isWebPushConfigured: vi.fn(),
  sendPushNotification: vi.fn(),
}));

vi.mock("./notify-user", () => ({
  notifyUser: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { isWebPushConfigured } from "./web-push";
import { notifyUser } from "./notify-user";
import {
  notifyGroupInvite,
  notifyGroupAccepted,
  notifyExpenseActivated,
  notifySettlementRecorded,
} from "./push-notify";

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
  });

  describe("notifyGroupInvite", () => {
    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifyGroupInvite("group-1", "invitee-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("sends notification to invitee with group name and inviter name", async () => {
      const chain = mockSupabaseChain({ data: null, error: null });
      // Override per-query responses
      let fromCallCount = 0;
      chain.from.mockImplementation((table: string) => {
        fromCallCount++;
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
      chain.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }));
      vi.mocked(createAdminClient).mockReturnValue(chain as never);

      await notifyGroupInvite("group-1", "invitee-1");

      expect(notifyUser).toHaveBeenCalledWith("invitee-1", {
        title: "Novo convite de grupo",
        body: 'Alguém convidou você para "um grupo"',
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

    it("notifies the inviter when invite is accepted", async () => {
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

    it("notifies affected users excluding creator", async () => {
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

      // Should notify user-2 and user-3, but not creator-1
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
  });

  describe("notifySettlementRecorded", () => {
    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifySettlementRecorded("group-1", "from-1", "to-1", 2500);

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("notifies the creditor with settlement details", async () => {
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

      // Should not throw
      await expect(
        notifySettlementRecorded("group-1", "from-1", "to-1", 1000),
      ).resolves.toBeUndefined();
    });
  });
});
