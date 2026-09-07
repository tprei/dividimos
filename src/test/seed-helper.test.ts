import { describe, it, expect, vi } from "vitest";
import { SeedHelper, createSeedHelper } from "../../e2e/seed-helper";
import type { SupabaseClient } from "@supabase/supabase-js";

type QueryResult = { data?: unknown; error?: unknown };

function createMockAdmin(
  spec: {
    selects?: Record<string, QueryResult>;
    deletes?: Record<string, QueryResult>;
  } = {},
) {
  const deletedTables: string[] = [];

  const admin = {
    from: vi.fn((table: string) => ({
      select: () => ({
        in: async () => spec.selects?.[table] ?? { data: [], error: null },
      }),
      delete: () => ({
        in: async () => {
          deletedTables.push(table);
          return spec.deletes?.[table] ?? { data: null, error: null };
        },
      }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    })),
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
        updateUserById: vi.fn().mockResolvedValue({ data: null, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    },
    rpc: vi.fn(),
  } as unknown as SupabaseClient;

  return { admin, deletedTables };
}

function setEnv(): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_JWT_SECRET =
    "super-secret-jwt-token-with-at-least-32-characters-long";
}

describe("SeedHelper", () => {
  describe("constructor", () => {
    it("throws when env vars are missing", () => {
      const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      expect(() => new SeedHelper(createMockAdmin().admin)).toThrow(
        "NEXT_PUBLIC_SUPABASE_URL",
      );

      process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
    });
  });

  describe("cleanup", () => {
    it("deletes the groups discovered for its own users before the users", async () => {
      setEnv();
      const { admin, deletedTables } = createMockAdmin({
        selects: {
          group_members: { data: [{ group_id: "group-1" }], error: null },
          groups: { data: [{ id: "group-2" }], error: null },
        },
      });

      const helper = new SeedHelper(admin);
      await helper.createUser();
      await helper.cleanup();

      expect(deletedTables).toEqual(["groups", "users"]);
      expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith("user-1");
    });

    it("throws with operation context instead of swallowing a delete failure", async () => {
      setEnv();
      const { admin } = createMockAdmin({
        selects: {
          group_members: { data: [{ group_id: "group-1" }], error: null },
        },
        deletes: {
          groups: { data: null, error: { message: "fk violation" } },
        },
      });

      const helper = new SeedHelper(admin);
      await helper.createUser();

      await expect(helper.cleanup()).rejects.toThrow(
        /group delete failed: fk violation/,
      );
    });

    it("throws when the membership lookup fails", async () => {
      setEnv();
      const { admin } = createMockAdmin({
        selects: {
          group_members: { data: null, error: { message: "timeout" } },
        },
      });

      const helper = new SeedHelper(admin);
      await helper.createUser();

      await expect(helper.cleanup()).rejects.toThrow(
        /group membership query failed: timeout/,
      );
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
