import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateNotificationPreferences } from "./actions";

function mockAuth(userId: string | null) {
  const getUser = vi.fn().mockResolvedValue({
    data: { user: userId ? { id: userId } : null },
  });
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

function mockAdmin(error: unknown = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ upsert });

  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);

  return { from, upsert };
}

describe("updateNotificationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when not authenticated", async () => {
    mockAuth(null);
    const result = await updateNotificationPreferences({ expenses: false });
    expect(result.error).toBe("Não autenticado");
  });

  it("saves valid preferences", async () => {
    mockAuth("user-1");
    const { upsert } = mockAdmin();

    const result = await updateNotificationPreferences({
      expenses: false,
      settlements: true,
      nudges: false,
    });

    expect(result.error).toBeUndefined();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        preferences: {
          expenses: false,
          settlements: true,
          nudges: false,
        },
      }),
      { onConflict: "user_id" },
    );
  });

  it("strips invalid category keys", async () => {
    mockAuth("user-1");
    const { upsert } = mockAdmin();

    const prefs = {
      expenses: true,
      bogus_key: false,
    } as Record<string, boolean>;

    await updateNotificationPreferences(prefs);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        preferences: { expenses: true },
      }),
      { onConflict: "user_id" },
    );
  });

  it("returns error when db upsert fails", async () => {
    mockAuth("user-1");
    mockAdmin({ message: "DB error" });

    const result = await updateNotificationPreferences({ expenses: false });
    expect(result.error).toBe("Erro ao salvar preferências");
  });
});
