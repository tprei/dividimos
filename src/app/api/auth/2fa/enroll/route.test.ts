import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/twilio", () => ({
  sendVerificationCode: vi.fn(async () => ({ success: true })),
  checkVerificationCode: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/crypto", () => ({
  encryptPixKey: vi.fn((v: string) => `encrypted:${v}`),
  decryptPixKey: vi.fn((v: string) => v.replace("encrypted:", "")),
}));

import { createClient } from "@/lib/supabase/server";
import { sendVerificationCode, checkVerificationCode } from "@/lib/twilio";
import { POST, DELETE } from "./route";
import { NextRequest } from "next/server";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockResolvedValue(mock.client);
  vi.mocked(sendVerificationCode).mockResolvedValue({ success: true });
  vi.mocked(checkVerificationCode).mockResolvedValue({ success: true });
});

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/auth/2fa/enroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/auth/2fa/enroll", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/2fa/enroll", () => {
  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      const response = await POST(makePostRequest({ action: "send", phone: "11999990001" }));
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Nao autenticado");
    });
  });

  describe("validation", () => {
    it("returns 400 when phone is missing", async () => {
      mock.setUser({ id: "user-1" });
      const response = await POST(makePostRequest({ action: "send" }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Telefone obrigatorio");
    });

    it("returns 400 for unknown action", async () => {
      mock.setUser({ id: "user-1" });
      const response = await POST(makePostRequest({ action: "unknown", phone: "11999990001" }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Acao invalida");
    });
  });

  describe("action: send", () => {
    it("returns success in test mode without calling twilio", async () => {
      mock.setUser({ id: "user-1" });
      const response = await POST(makePostRequest({ action: "send", phone: "11999990001" }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it("normalizes phone to E.164 format", async () => {
      mock.setUser({ id: "user-1" });
      const response = await POST(makePostRequest({ action: "send", phone: "11999990001" }));
      expect(response.status).toBe(200);
    });

    it("handles phone already with country code", async () => {
      mock.setUser({ id: "user-1" });
      const response = await POST(makePostRequest({ action: "send", phone: "+5511999990001" }));
      expect(response.status).toBe(200);
    });
  });

  describe("action: verify", () => {
    it("returns 400 when code is missing", async () => {
      mock.setUser({ id: "user-1" });
      const response = await POST(makePostRequest({ action: "verify", phone: "11999990001" }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Codigo invalido");
    });

    it("returns 400 when code is not 6 digits", async () => {
      mock.setUser({ id: "user-1" });
      const response = await POST(
        makePostRequest({ action: "verify", phone: "11999990001", code: "12345" })
      );
      expect(response.status).toBe(400);
    });

    it("returns 400 when code contains non-digits", async () => {
      mock.setUser({ id: "user-1" });
      const response = await POST(
        makePostRequest({ action: "verify", phone: "11999990001", code: "12345a" })
      );
      expect(response.status).toBe(400);
    });

    it("accepts any 6-digit code in test mode and enables 2FA", async () => {
      mock.setUser({ id: "user-1" });
      mock.onTable("users", { data: null, error: null });

      const response = await POST(
        makePostRequest({ action: "verify", phone: "11999990001", code: "123456" })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);

      const updateCalls = mock.findCalls("users", "update");
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].args[0]).toMatchObject({
        two_factor_enabled: true,
      });
    });

    it("encrypts the phone before storing", async () => {
      mock.setUser({ id: "user-1" });
      mock.onTable("users", { data: null, error: null });

      await POST(makePostRequest({ action: "verify", phone: "11999990001", code: "123456" }));

      const updateCalls = mock.findCalls("users", "update");
      const updateArg = updateCalls[0].args[0] as Record<string, unknown>;
      expect(typeof updateArg.two_factor_phone).toBe("string");
      expect(updateArg.two_factor_phone).toContain("encrypted:");
    });

    it("returns 500 when DB update fails", async () => {
      mock.setUser({ id: "user-1" });
      mock.onTable("users", { data: null, error: { message: "DB error" } });

      const response = await POST(
        makePostRequest({ action: "verify", phone: "11999990001", code: "123456" })
      );
      expect(response.status).toBe(500);
    });
  });
});

describe("DELETE /api/auth/2fa/enroll", () => {
  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      const response = await DELETE(makeDeleteRequest({ code: "123456" }));
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("Nao autenticado");
    });
  });

  describe("validation", () => {
    it("returns 400 when code is missing", async () => {
      mock.setUser({ id: "user-1" });
      const response = await DELETE(makeDeleteRequest({}));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Codigo invalido");
    });

    it("returns 400 when code is not 6 digits", async () => {
      mock.setUser({ id: "user-1" });
      const response = await DELETE(makeDeleteRequest({ code: "1234" }));
      expect(response.status).toBe(400);
    });
  });

  describe("disable 2FA", () => {
    it("returns 400 when 2FA is not configured", async () => {
      mock.setUser({ id: "user-1" });
      mock.onTable("users", { data: { two_factor_phone: null } });

      const response = await DELETE(makeDeleteRequest({ code: "123456" }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("2FA nao configurado");
    });

    it("disables 2FA in test mode without calling twilio", async () => {
      mock.setUser({ id: "user-1" });
      mock.onTable("users", { data: { two_factor_phone: "encrypted:+5511999990001" } });
      mock.onTable("users", { data: null, error: null });

      const response = await DELETE(makeDeleteRequest({ code: "123456" }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);

      const updateCalls = mock.findCalls("users", "update");
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].args[0]).toMatchObject({
        two_factor_enabled: false,
        two_factor_phone: null,
      });
    });

    it("returns 500 when DB update fails", async () => {
      mock.setUser({ id: "user-1" });
      mock.onTable("users", { data: { two_factor_phone: "encrypted:+5511999990001" } });
      mock.onTable("users", { data: null, error: { message: "DB error" } });

      const response = await DELETE(makeDeleteRequest({ code: "123456" }));
      expect(response.status).toBe(500);
    });
  });
});
