import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/crypto", () => ({
  encryptPixKey: vi.fn().mockReturnValue("encrypted-payload"),
}));

vi.mock("@/lib/pix", () => ({
  validatePixKey: vi.fn().mockReturnValue(true),
  maskPixKey: vi.fn().mockReturnValue("m*****@test.com"),
}));

import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptPixKey } from "@/lib/crypto";
import { validatePixKey, maskPixKey } from "@/lib/pix";
import { updatePixKey } from "./actions";
import type { Me } from "@/types/ledger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
function mockUser(id: string): Me {
  return {
    id,
    handle: "testuser",
    name: "Test User",
    avatarUrl: null,
    email: "test@example.com",
    pixKeyType: null,
    pixKeyHint: null,
    onboarded: true,
    notificationPreferences: {},
  };
}

function mockAuth(userId: string | null) {
  vi.mocked(getAuthUser).mockResolvedValue(userId ? mockUser(userId) : null);
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  vi.mocked(createAdminClient).mockReturnValue({
    from,
  } as unknown as SupabaseClient<Database>);
  return { from, update, eq };
}

function pixFormData(pixKey: string, pixKeyType: string) {
  const formData = new FormData();
  formData.set("pixKey", pixKey);
  formData.set("pixKeyType", pixKeyType);
  return formData;
}

describe("updatePixKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates, encrypts, and updates the verified user when the expected id matches fresh auth", async () => {
    const { from, update, eq } = mockAuth("real-user");

    const result = await updatePixKey("real-user", pixFormData("user@test.com", "email"));

    expect(result).toEqual({ pixKeyType: "email", pixKeyHint: "m*****@test.com" });
    expect(validatePixKey).toHaveBeenCalledWith("user@test.com", "email");
    expect(encryptPixKey).toHaveBeenCalledWith("user@test.com");
    expect(maskPixKey).toHaveBeenCalledWith("user@test.com");
    expect(from).toHaveBeenCalledWith("users");
    expect(update).toHaveBeenCalledWith({
      pix_key_encrypted: "encrypted-payload",
      pix_key_hint: "m*****@test.com",
      pix_key_type: "email",
    });
    // The row written is the verified user id.
    expect(eq).toHaveBeenCalledWith("id", "real-user");
  });

  it("returns the session error and does zero work when the expected id differs from fresh auth", async () => {
    const { from, update, eq } = mockAuth("real-user");

    const result = await updatePixKey("stale-or-other-user", pixFormData("user@test.com", "email"));

    expect(result).toEqual({ error: "Sessao expirada" });
    expect(validatePixKey).not.toHaveBeenCalled();
    expect(encryptPixKey).not.toHaveBeenCalled();
    expect(maskPixKey).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(eq).not.toHaveBeenCalled();
  });

  it("returns the session error and does zero work when there is no session at all", async () => {
    const { from, update, eq } = mockAuth(null);

    const result = await updatePixKey("real-user", pixFormData("user@test.com", "email"));

    expect(result).toEqual({ error: "Sessao expirada" });
    expect(validatePixKey).not.toHaveBeenCalled();
    expect(encryptPixKey).not.toHaveBeenCalled();
    expect(maskPixKey).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(eq).not.toHaveBeenCalled();
  });

  it("rejects instead of writing either row when auth succeeds but the caller supplied a different user id", async () => {
    // Fresh auth verifies real-user, but the caller claimed other-user. The
    // call is rejected outright: neither row is touched and no key work runs.
    const { from, update, eq } = mockAuth("real-user");

    const result = await updatePixKey("other-user", pixFormData("user@test.com", "email"));

    expect(result).toEqual({ error: "Sessao expirada" });
    expect(encryptPixKey).not.toHaveBeenCalled();
    expect(maskPixKey).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(eq).not.toHaveBeenCalled();
  });
});
