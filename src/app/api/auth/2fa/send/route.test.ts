import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/twilio", () => ({
  sendVerificationCode: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/crypto", () => ({
  decryptPixKey: vi.fn().mockReturnValue("+5511999990001"),
}));

import { createClient } from "@/lib/supabase/server";
import { sendVerificationCode } from "@/lib/twilio";
import { POST } from "./route";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockResolvedValue(mock.client);
  vi.mocked(sendVerificationCode).mockResolvedValue({ success: true });
  vi.stubEnv("NEXT_PUBLIC_AUTH_PHONE_TEST_MODE", "false");
});

describe("POST /api/auth/2fa/send", () => {
  it("returns 401 when unauthenticated", async () => {
    const response = await POST();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when 2FA is not enabled", async () => {
    mock.setUser({ id: "user-1" });
    mock.onTable("users", {
      data: { two_factor_enabled: false, two_factor_phone: null },
      error: null,
    });

    const response = await POST();

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when no 2FA phone is configured", async () => {
    mock.setUser({ id: "user-1" });
    mock.onTable("users", {
      data: { two_factor_enabled: true, two_factor_phone: null },
      error: null,
    });

    const response = await POST();

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  it("returns success in test mode without calling sendVerificationCode", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PHONE_TEST_MODE", "true");
    mock.setUser({ id: "user-1" });
    mock.onTable("users", {
      data: { two_factor_enabled: true, two_factor_phone: "encrypted-phone" },
      error: null,
    });

    const response = await POST();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it("calls sendVerificationCode with decrypted phone in production mode", async () => {
    mock.setUser({ id: "user-1" });
    mock.onTable("users", {
      data: { two_factor_enabled: true, two_factor_phone: "encrypted-phone" },
      error: null,
    });

    const response = await POST();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(sendVerificationCode).toHaveBeenCalledWith("+5511999990001");
  });
});
