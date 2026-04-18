import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotificationCategory, NotificationPreferences } from "@/types";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));

import { createAdminClient } from "@/lib/supabase/admin";
import { checkPreference } from "./push-notify";

function mockAdminWithPrefs(prefs: NotificationPreferences | null) {
  const single = vi.fn().mockResolvedValue({
    data: prefs !== null ? { preferences: prefs } : null,
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);
}

describe("checkPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when user has no preferences (empty object)", async () => {
    mockAdminWithPrefs({});
    const result = await checkPreference("user-1", "expenses");
    expect(result).toBe(true);
  });

  it("returns true when category is explicitly enabled", async () => {
    mockAdminWithPrefs({ expenses: true });
    const result = await checkPreference("user-1", "expenses");
    expect(result).toBe(true);
  });

  it("returns false when category is explicitly disabled", async () => {
    mockAdminWithPrefs({ expenses: false });
    const result = await checkPreference("user-1", "expenses");
    expect(result).toBe(false);
  });

  it("returns true for categories not present in preferences (opt-out model)", async () => {
    mockAdminWithPrefs({ nudges: false });
    const result = await checkPreference("user-1", "expenses");
    expect(result).toBe(true);
  });

  it("returns true when user is not found", async () => {
    mockAdminWithPrefs(null);
    const result = await checkPreference("user-unknown", "groups");
    expect(result).toBe(true);
  });

  it("checks each category independently", async () => {
    const prefs: NotificationPreferences = {
      expenses: false,
      settlements: true,
      nudges: false,
      groups: true,
      messages: false,
    };
    const categories: NotificationCategory[] = [
      "expenses",
      "settlements",
      "nudges",
      "groups",
      "messages",
    ];
    const expected = [false, true, false, true, false];

    for (let i = 0; i < categories.length; i++) {
      mockAdminWithPrefs(prefs);
      const result = await checkPreference("user-1", categories[i]);
      expect(result).toBe(expected[i]);
    }
  });
});
