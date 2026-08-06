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
                    eq: () => ({
                      single: () =>
                        Promise.resolve({ data: null, error: null }),
                    }),
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
        url: "/app/groups/group-1",
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
        url: "/app/groups/group-1",
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
                    eq: () => ({
                      single: () =>
                        Promise.resolve({
                          data: { invited_by: "creator-1" },
                          error: null,
                        }),
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
        url: "/app/groups/group-1",
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
                  eq: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { invited_by: "inviter-1" },
                        error: null,
                      }),
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
                  eq: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { invited_by: "same-user" },
                        error: null,
                      }),
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
    // Mocks the admin.from("expenses").update({...}).eq().eq().eq().is()
    // .select().maybeSingle() atomic claim chain used by the one-shot
    // activation-notification guard (#534).
    function mockClaimChain(result: { data: unknown; error: unknown }) {
      const claimTail = { maybeSingle: () => Promise.resolve(result) };
      const claimChain: Record<string, unknown> = {
        select: () => claimTail,
      };
      claimChain.is = () => claimChain;
      const eqChain: Record<string, unknown> = { eq: () => eqChain, is: () => claimChain };
      return {
        update: () => eqChain,
      };
    }

    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifyExpenseActivated("expense-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when the claim finds no matching row (draft, settled, noncreator, nonexistent, or replay)", async () => {
      mockCaller("not-the-creator");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "expenses") {
          return mockClaimChain({ data: null, error: null });
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

    it("notifies affected users excluding creator on the first successful claim", async () => {
      mockCaller("creator-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "expenses") {
          return mockClaimChain({
            data: {
              group_id: "group-1",
              creator_id: "creator-1",
              title: "Pizza",
              total_amount: 5000,
            },
            error: null,
          });
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

    it("omits group name and deep-links to the conversation in a DM", async () => {
      // DM groups have no meaningful `name` — using it verbatim produced
      // titles like 'Nova despesa em ""'. For DMs we should omit the group
      // part and deep-link to /app/conversations/<creator> instead.
      mockCaller("creator-1");

      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "expenses") {
          return mockClaimChain({
            data: {
              group_id: "dm-group-1",
              creator_id: "creator-1",
              title: "Almoço",
              total_amount: 4500,
            },
            error: null,
          });
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
    const settlementRow = {
      group_id: "group-1",
      from_user_id: "from-1",
      to_user_id: "to-1",
      amount_cents: 2500,
    };

    function setupChain(opts: {
      settlement?: typeof settlementRow | null;
      group?: { name: string; is_dm?: boolean } | null;
      dmPair?: { user_a: string; user_b: string } | null;
      profileName?: string | null;
    }) {
      const chain = mockSupabaseChain({ data: null, error: null });
      chain.from.mockImplementation((table: string) => {
        if (table === "settlements") {
          return {
            update: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    select: () => ({
                      maybeSingle: () =>
                        Promise.resolve({ data: opts.settlement ?? null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: opts.group ?? null, error: null }),
              }),
            }),
          };
        }
        if (table === "dm_pairs") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: opts.dmPair ?? null, error: null }),
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
                    data: opts.profileName != null ? { name: opts.profileName } : null,
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);
    }

    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifySettlementRecorded("settlement-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is not authenticated", async () => {
      mockCaller(null);

      await notifySettlementRecorded("settlement-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when the settlement does not exist", async () => {
      mockCaller("from-1");
      setupChain({ settlement: null });

      await notifySettlementRecorded("settlement-missing");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is neither party in the settlement", async () => {
      mockCaller("outsider");
      setupChain({ settlement: settlementRow });

      await notifySettlementRecorded("settlement-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when the settlement is pending (not yet confirmed)", async () => {
      mockCaller("from-1");
      setupChain({ settlement: null });

      await notifySettlementRecorded("settlement-pending");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips on replay (notification already claimed)", async () => {
      mockCaller("from-1");
      setupChain({ settlement: null });

      await notifySettlementRecorded("settlement-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("notifies the creditor when the debtor records the settlement (pay mode)", async () => {
      mockCaller("from-1");
      setupChain({ settlement: settlementRow, group: { name: "Casa" }, profileName: "Ana" });

      await notifySettlementRecorded("settlement-1");

      expect(notifyUser).toHaveBeenCalledWith("to-1", {
        title: "Pagamento registrado",
        body: 'Ana pagou R$\u00a025,00 em "Casa"',
        url: "/app/groups/group-1",
        tag: "settlement-group-1",
      });
    });

    it("swallows errors from notifyUser", async () => {
      mockCaller("from-1");
      setupChain({ settlement: settlementRow, group: { name: "G" }, profileName: "X" });
      vi.mocked(notifyUser).mockRejectedValue(new Error("push failed"));

      await expect(
        notifySettlementRecorded("settlement-1"),
      ).resolves.toBeUndefined();
    });

    it("omits group name and deep-links to the conversation in a DM", async () => {
      mockCaller("from-1");
      setupChain({
        settlement: settlementRow,
        group: { name: "", is_dm: true },
        dmPair: { user_a: "from-1", user_b: "to-1" },
        profileName: "Ana",
      });

      await notifySettlementRecorded("settlement-1");

      expect(notifyUser).toHaveBeenCalledWith("to-1", {
        title: "Pagamento registrado",
        body: "Ana pagou R$\u00a025,00",
        url: "/app/conversations/from-1",
        tag: "settlement-group-1",
      });
    });

    it("notifies the debtor when the creditor records a collection (collect mode)", async () => {
      mockCaller("to-1");
      setupChain({ settlement: settlementRow, group: { name: "Viagem" }, profileName: "Bia" });

      await notifySettlementRecorded("settlement-1");

      expect(notifyUser).toHaveBeenCalledWith("from-1", {
        title: "Pagamento registrado",
        body: 'Bia marcou seu pagamento de R$\u00a025,00 como recebido em "Viagem"',
        url: "/app/groups/group-1",
        tag: "settlement-group-1",
      });
    });

    it("notifies the debtor in a DM when the creditor records a collection", async () => {
      mockCaller("to-1");
      setupChain({
        settlement: settlementRow,
        group: { name: "", is_dm: true },
        dmPair: { user_a: "to-1", user_b: "from-1" },
        profileName: "Bia",
      });

      await notifySettlementRecorded("settlement-1");

      expect(notifyUser).toHaveBeenCalledWith("from-1", {
        title: "Pagamento registrado",
        body: "Bia marcou seu pagamento de R$\u00a025,00 como recebido",
        url: "/app/conversations/to-1",
        tag: "settlement-group-1",
      });
    });
  });

  describe("notifyDmTextMessage", () => {
    // The function re-derives the message preview from the latest committed
    // chat_messages row sent by the caller, so callers cannot inject text.
    function setupChain(opts: {
      dmPair?: { user_a: string; user_b: string } | null;
      message?: string | null;
      senderName?: string | null;
      acceptedMembers?: { user_id: string }[] | null;
    }) {
      const chain = mockSupabaseChain({ data: null, error: null });
      const acceptedMembers =
        opts.acceptedMembers ??
        (opts.dmPair
          ? [{ user_id: opts.dmPair.user_a }, { user_id: opts.dmPair.user_b }]
          : null);
      chain.from.mockImplementation((table: string) => {
        if (table === "dm_pairs") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: opts.dmPair ?? null, error: null }),
              }),
            }),
          };
        }
        if (table === "group_members") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () =>
                    Promise.resolve({ data: acceptedMembers, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "chat_messages") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      single: () =>
                        Promise.resolve({
                          data: opts.message != null ? { content: opts.message } : null,
                          error: null,
                        }),
                    }),
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
                    data: opts.senderName != null ? { name: opts.senderName } : null,
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);
    }

    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifyDmTextMessage("group-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is not authenticated", async () => {
      mockCaller(null);

      await notifyDmTextMessage("group-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when dm_pairs row is not found", async () => {
      setupChain({ dmPair: null });

      await notifyDmTextMessage("group-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when no message exists from the caller", async () => {
      mockCaller("user-a");
      setupChain({
        dmPair: { user_a: "user-a", user_b: "user-b" },
        message: null,
      });

      await notifyDmTextMessage("group-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("notifies counterparty (user_b) when sender is user_a", async () => {
      mockCaller("user-a");
      setupChain({
        dmPair: { user_a: "user-a", user_b: "user-b" },
        message: "Oi, tudo bem?",
        senderName: "Alice",
      });

      await notifyDmTextMessage("group-1");

      expect(notifyUser).toHaveBeenCalledWith("user-b", {
        title: "Alice",
        body: "Oi, tudo bem?",
        url: "/app/conversations/user-a",
        tag: "dm-group-1",
      });
    });

    it("notifies counterparty (user_a) when sender is user_b", async () => {
      mockCaller("user-b");
      setupChain({
        dmPair: { user_a: "user-a", user_b: "user-b" },
        message: "Vamos dividir?",
        senderName: "Bob",
      });

      await notifyDmTextMessage("group-1");

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
      setupChain({
        dmPair: { user_a: "user-a", user_b: "user-b" },
        message: longMessage,
        senderName: "Alice",
      });

      await notifyDmTextMessage("group-1");

      expect(notifyUser).toHaveBeenCalledWith("user-b", expect.objectContaining({
        body: "A".repeat(77) + "\u2026",
      }));
    });

    it("uses fallback name when sender profile not found", async () => {
      mockCaller("user-a");
      setupChain({
        dmPair: { user_a: "user-a", user_b: "user-b" },
        message: "Oi!",
        senderName: null,
      });

      await notifyDmTextMessage("group-1");

      expect(notifyUser).toHaveBeenCalledWith("user-b", expect.objectContaining({
        title: "Alguém",
      }));
    });

    it("swallows errors from notifyUser", async () => {
      mockCaller("user-a");
      setupChain({
        dmPair: { user_a: "user-a", user_b: "user-b" },
        message: "Oi!",
        senderName: "X",
      });
      vi.mocked(notifyUser).mockRejectedValue(new Error("push failed"));

      await expect(
        notifyDmTextMessage("group-1"),
      ).resolves.toBeUndefined();
    });

    it("skips when the counterparty has not accepted the DM", async () => {
      mockCaller("user-a");
      setupChain({
        dmPair: { user_a: "user-a", user_b: "user-b" },
        message: "Oi!",
        senderName: "Alice",
        // only the caller has accepted; the counterparty is still 'invited'
        acceptedMembers: [{ user_id: "user-a" }],
      });

      await notifyDmTextMessage("group-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when the caller is not an accepted member", async () => {
      mockCaller("user-a");
      setupChain({
        dmPair: { user_a: "user-a", user_b: "user-b" },
        message: "Oi!",
        senderName: "Alice",
        acceptedMembers: [{ user_id: "user-b" }],
      });

      await notifyDmTextMessage("group-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });
  });

  describe("notifyPaymentNudge", () => {
    function setupChain(opts: {
      claimResult?: { amount_cents: number }[] | null;
      group?: { name: string; is_dm?: boolean } | null;
      dmPair?: { user_a: string; user_b: string } | null;
      profileName?: string | null;
    }) {
      const chain = mockSupabaseChain({ data: null, error: null });
      chain.rpc = vi.fn().mockResolvedValue({
        data: opts.claimResult ?? null,
        error: null,
      });
      chain.from.mockImplementation((table: string) => {
        if (table === "groups") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: opts.group ?? null, error: null }),
              }),
            }),
          };
        }
        if (table === "dm_pairs") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: opts.dmPair ?? null, error: null }),
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
                    data: opts.profileName != null ? { name: opts.profileName } : null,
                    error: null,
                  }),
              }),
            }),
          };
        }
        return chain;
      });
      vi.mocked(createAdminClient).mockReturnValue(chain as never);
    }

    it("skips when web push is not configured", async () => {
      vi.mocked(isWebPushConfigured).mockReturnValue(false);

      await notifyPaymentNudge("group-1", "debtor-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is the debtor", async () => {
      mockCaller("debtor-1");

      await notifyPaymentNudge("group-1", "debtor-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when caller is not authenticated", async () => {
      mockCaller(null);

      await notifyPaymentNudge("group-1", "debtor-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("skips when claim_nudge returns nothing (no balance, unauthorized, or cooldown)", async () => {
      mockCaller("creditor-1");
      setupChain({ claimResult: null });

      await notifyPaymentNudge("group-1", "debtor-1");

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it("notifies debtor with amount from claim_nudge RPC", async () => {
      mockCaller("creditor-1");
      setupChain({
        claimResult: [{ amount_cents: 5000 }],
        group: { name: "Viagem" },
        profileName: "João",
      });

      await notifyPaymentNudge("group-1", "debtor-1");

      expect(notifyUser).toHaveBeenCalledWith("debtor-1", {
        title: "Lembrete de pagamento",
        body: 'João pediu R$\u00a050,00 em "Viagem"',
        url: "/app/groups/group-1",
        tag: "nudge-group-1-creditor-1",
      });
    });

    it("uses fallback names when group and profile are missing", async () => {
      mockCaller("creditor-1");
      setupChain({ claimResult: [{ amount_cents: 5000 }] });

      await notifyPaymentNudge("group-1", "debtor-1");

      expect(notifyUser).toHaveBeenCalledWith("debtor-1", {
        title: "Lembrete de pagamento",
        body: 'Alguém pediu R$\u00a050,00 em "um grupo"',
        url: "/app/groups/group-1",
        tag: "nudge-group-1-creditor-1",
      });
    });
  });
});
