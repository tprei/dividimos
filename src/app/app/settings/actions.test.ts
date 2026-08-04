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
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });

  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);

  return { from, update, eq };
}

describe("updateNotificationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error and does no privileged work when there is no session", async () => {
    mockAuth(null);

    const result = await updateNotificationPreferences("user-1", { expenses: false });

    expect(result.error).toBe("Não autenticado");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns an error and does no privileged work when the expected id does not match the session", async () => {
    mockAuth("user-1");

    const result = await updateNotificationPreferences("user-2", { expenses: false });

    expect(result.error).toBe("Não autenticado");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("sanitizes preferences and updates the verified user when the expected id matches", async () => {
    mockAuth("user-1");
    const { from, update, eq } = mockAdmin();

    const result = await updateNotificationPreferences("user-1", {
      expenses: false,
      settlements: true,
      nudges: false,
    });

    expect(result.error).toBeUndefined();
    expect(from).toHaveBeenCalledWith("users");
    expect(update).toHaveBeenCalledWith({
      notification_preferences: {
        expenses: false,
        settlements: true,
        nudges: false,
      },
    });
    // The row written targets the verified session user, not the (matching) expected id.
    expect(eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("drops unknown category keys and non-boolean values before writing", async () => {
    mockAuth("user-1");
    const { update } = mockAdmin();

    const prefs = {
      expenses: true,
      bogus_key: false,
      settlements: "yes" as unknown as boolean,
    } as Record<string, boolean>;

    await updateNotificationPreferences("user-1", prefs);

    expect(update).toHaveBeenCalledWith({
      notification_preferences: { expenses: true },
    });
  });

  it("returns an error when the db update fails", async () => {
    mockAuth("user-1");
    mockAdmin({ message: "DB error" });

    const result = await updateNotificationPreferences("user-1", { expenses: false });
    expect(result.error).toBe("Erro ao salvar preferências");
  });
});
