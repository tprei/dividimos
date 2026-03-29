import { describe, it, expect, vi } from "vitest";
import { SeedHelper, createSeedHelper } from "../../e2e/seed-helper";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Mock Supabase client builder
// ---------------------------------------------------------------------------

function mockQuery(data: unknown = null, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "in", "neq", "single", "maybeSingle"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal — returns the result
  chain.select = vi.fn().mockReturnValue({ ...chain, single: vi.fn().mockResolvedValue({ data, error }) });
  chain.insert = vi.fn().mockReturnValue({ ...chain, select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data, error }) }) });
  chain.delete = vi.fn().mockReturnValue({ ...chain, in: vi.fn().mockResolvedValue({ data, error }) });
  chain.update = vi.fn().mockReturnValue({ ...chain, eq: vi.fn().mockResolvedValue({ data, error }) });
  return chain;
}

function createMockAdmin(): SupabaseClient {
  const fromResults: Record<string, ReturnType<typeof mockQuery>> = {};

  return {
    from: vi.fn((table: string) => {
      if (!fromResults[table]) {
        fromResults[table] = mockQuery();
      }
      return fromResults[table];
    }),
    auth: {
      admin: {
        createUser: vi.fn(),
        updateUserById: vi.fn(),
        deleteUser: vi.fn(),
        getUserById: vi.fn(),
        generateLink: vi.fn(),
      },
    },
    rpc: vi.fn(),
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SeedHelper", () => {
  describe("constructor", () => {
    it("throws when env vars are missing", () => {
      const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      expect(() => new SeedHelper(createMockAdmin())).toThrow(
        "NEXT_PUBLIC_SUPABASE_URL",
      );

      process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
    });

    it("creates instance when env vars are set", () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

      const helper = new SeedHelper(createMockAdmin());
      expect(helper).toBeInstanceOf(SeedHelper);
    });
  });

  describe("equalSplit (via createExpense)", () => {
    // We test the equal split logic indirectly by checking
    // the shares inserted when no explicit shares are provided.
    // The method is private, so we verify through observable behavior.

    it("splits evenly when divisible", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

      const admin = createMockAdmin();
      const insertedShares: Array<{ share_amount_cents: number }> = [];

      // Mock expense insert
      (admin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
        if (table === "expenses") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "exp-1", title: "Test" },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "expense_shares") {
          return {
            insert: vi.fn().mockImplementation((rows: Array<{ share_amount_cents: number }>) => {
              insertedShares.push(...rows);
              return Promise.resolve({ error: null });
            }),
          };
        }
        if (table === "expense_payers") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return mockQuery();
      });

      const helper = new SeedHelper(admin);
      await helper.createExpense(
        "group-1",
        "user-a",
        ["user-a", "user-b"],
        { totalAmount: 10000 },
      );

      expect(insertedShares).toHaveLength(2);
      expect(insertedShares[0].share_amount_cents).toBe(5000);
      expect(insertedShares[1].share_amount_cents).toBe(5000);
    });

    it("handles remainder cents correctly", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

      const admin = createMockAdmin();
      const insertedShares: Array<{ share_amount_cents: number }> = [];

      (admin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
        if (table === "expenses") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "exp-2", title: "Test" },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "expense_shares") {
          return {
            insert: vi.fn().mockImplementation((rows: Array<{ share_amount_cents: number }>) => {
              insertedShares.push(...rows);
              return Promise.resolve({ error: null });
            }),
          };
        }
        if (table === "expense_payers") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return mockQuery();
      });

      const helper = new SeedHelper(admin);
      // 10001 / 3 = 3333 remainder 2
      await helper.createExpense(
        "group-1",
        "user-a",
        ["user-a", "user-b", "user-c"],
        { totalAmount: 10001 },
      );

      expect(insertedShares).toHaveLength(3);
      // First two get 3334, third gets 3333
      const amounts = insertedShares.map((s) => s.share_amount_cents);
      expect(amounts.sort()).toEqual([3333, 3334, 3334]);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(10001);
    });
  });

  describe("cleanup order", () => {
    it("calls delete in correct dependency order", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

      const admin = createMockAdmin();
      const deleteCalls: string[] = [];

      (admin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => ({
        delete: vi.fn().mockImplementation(() => {
          deleteCalls.push(table);
          return {
            in: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: "test-id", name: "test" },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }));

      // Mock auth methods for createUser
      (admin.auth.admin.createUser as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      });
      (admin.auth.admin.updateUserById as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      });
      (admin.auth.admin.deleteUser as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: null,
        error: null,
      });

      const helper = new SeedHelper(admin);

      // Simulate tracked entities by calling internal tracking
      // We can't call createUser (needs real signIn), so we manually
      // push IDs to test cleanup order
      const h = helper as unknown as {
        userIds: string[];
        groupIds: string[];
        expenseIds: string[];
        settlementIds: string[];
      };
      h.userIds = ["user-1"];
      h.groupIds = ["group-1"];
      h.expenseIds = ["exp-1"];
      h.settlementIds = ["settle-1"];

      await helper.cleanup();

      // Should delete in order: settlements, expense children, balances, expenses, group members, groups, users
      expect(deleteCalls).toEqual([
        "settlements",
        "expense_payers",
        "expense_shares",
        "expense_items",
        "balances",
        "expenses",
        "group_members",
        "groups",
        "users",
      ]);

      // Auth users also cleaned up
      expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith("user-1");
    });
  });

  describe("createSeedHelper", () => {
    it("throws when env vars are missing", () => {
      const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      expect(() => createSeedHelper()).toThrow("NEXT_PUBLIC_SUPABASE_URL");

      process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    });
  });
});
