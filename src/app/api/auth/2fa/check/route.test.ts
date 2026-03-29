import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

// Mock next/headers cookies
const mockCookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    set: (...args: unknown[]) => mockCookieSet(...args),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// Mock twilio module (used in production mode only)
vi.mock("@/lib/twilio", () => ({
  verifyCode: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  decryptPixKey: vi.fn((v: string) => `decrypted:${v}`),
}));

import { createClient } from "@/lib/supabase/server";
import { POST } from "./route";

let mock: MockSupabase;

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/2fa/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockResolvedValue(mock.client);
  mockCookieSet.mockClear();
  process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE = "true";
  process.env.PIX_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE;
  delete process.env.PIX_ENCRYPTION_KEY;
});

describe("POST /api/auth/2fa/check", () => {
  it("returns 401 when not authenticated", async () => {
    const response = await POST(makeRequest({ code: "123456" }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Não autenticado");
  });

  it("returns 400 for missing code", async () => {
    mock.setUser({ id: "user-1" });
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Código deve ter 6 dígitos");
  });

  it("returns 400 for non-6-digit code", async () => {
    mock.setUser({ id: "user-1" });
    const response = await POST(makeRequest({ code: "12345" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for non-numeric code", async () => {
    mock.setUser({ id: "user-1" });
    const response = await POST(makeRequest({ code: "abcdef" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when invalid JSON body", async () => {
    mock.setUser({ id: "user-1" });
    const request = new Request("http://localhost/api/auth/2fa/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Corpo da requisição inválido");
  });

  it("returns 404 when user not found in DB", async () => {
    mock.setUser({ id: "user-1" });
    mock.onTable("users", { data: null, error: { message: "not found" } });
    const response = await POST(makeRequest({ code: "123456" }));
    expect(response.status).toBe(404);
  });

  it("returns 400 when 2FA is not enabled", async () => {
    mock.setUser({ id: "user-1" });
    mock.onTable("users", {
      data: { two_factor_enabled: false, two_factor_phone: null },
    });
    const response = await POST(makeRequest({ code: "123456" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("2FA não está habilitado para esta conta");
  });

  it("returns 400 when 2FA phone not configured", async () => {
    mock.setUser({ id: "user-1" });
    mock.onTable("users", {
      data: { two_factor_enabled: true, two_factor_phone: null },
    });
    const response = await POST(makeRequest({ code: "123456" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Telefone de 2FA não configurado");
  });

  describe("test mode", () => {
    it("accepts any 6-digit code and sets cookie", async () => {
      mock.setUser({ id: "user-1" });
      mock.onTable("users", {
        data: {
          two_factor_enabled: true,
          two_factor_phone: "encrypted-phone",
        },
      });

      const response = await POST(makeRequest({ code: "000000" }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.verified).toBe(true);

      // Cookie was set
      expect(mockCookieSet).toHaveBeenCalledOnce();
      const [name, value, options] = mockCookieSet.mock.calls[0];
      expect(name).toBe("2fa-verified");
      expect(value).toMatch(/^user-1:\d+:[A-Za-z0-9_-]+$/);
      expect(options).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 86400,
      });
    });
  });

  describe("production mode", () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE;
    });

    it("verifies code via Twilio and sets cookie on success", async () => {
      const { verifyCode } = await import("@/lib/twilio");
      vi.mocked(verifyCode).mockResolvedValue({ valid: true });

      mock.setUser({ id: "user-1" });
      mock.onTable("users", {
        data: {
          two_factor_enabled: true,
          two_factor_phone: "encrypted-phone",
        },
      });

      const response = await POST(makeRequest({ code: "123456" }));
      expect(response.status).toBe(200);
      expect(vi.mocked(verifyCode)).toHaveBeenCalledWith(
        "decrypted:encrypted-phone",
        "123456",
      );
      expect(mockCookieSet).toHaveBeenCalledOnce();
    });

    it("returns 401 when Twilio rejects code", async () => {
      const { verifyCode } = await import("@/lib/twilio");
      vi.mocked(verifyCode).mockResolvedValue({ valid: false });

      mock.setUser({ id: "user-1" });
      mock.onTable("users", {
        data: {
          two_factor_enabled: true,
          two_factor_phone: "encrypted-phone",
        },
      });

      const response = await POST(makeRequest({ code: "999999" }));
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Código inválido ou expirado");
      expect(mockCookieSet).not.toHaveBeenCalled();
    });
  });
});
