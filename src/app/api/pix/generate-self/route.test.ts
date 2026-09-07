import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "@/test/mock-supabase";

const serverMock = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

const adminMock = createMockSupabase();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => adminMock.client),
}));

vi.mock("@/lib/crypto", () => ({
  decryptPixKey: vi.fn(() => "decrypted-self-key@example.com"),
}));

vi.mock("@/lib/pix", () => ({
  generatePixCopiaECola: vi.fn(() => "00020126580014br.gov.bcb.pix...self"),
}));

import { decryptPixKey } from "@/lib/crypto";
import { POST } from "./route";

beforeEach(() => {
  serverMock.reset();
  adminMock.reset();
  vi.mocked(decryptPixKey).mockClear();
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/pix/generate-self", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pix/generate-self", () => {
  it("returns 401 when not authenticated", async () => {
    const response = await POST(makeRequest({ amountCents: 5000 }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Não autenticado");
  });

  it("returns 400 when amountCents is missing", async () => {
    serverMock.setUser({ id: "user-alice" });
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Valor invalido");
  });

  it("returns 400 when amountCents is 0 or negative", async () => {
    serverMock.setUser({ id: "user-alice" });
    const response = await POST(makeRequest({ amountCents: 0 }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when amountCents is not an integer", async () => {
    serverMock.setUser({ id: "user-alice" });
    const response = await POST(makeRequest({ amountCents: 10.5 }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when amountCents exceeds R$100,000 cap", async () => {
    serverMock.setUser({ id: "user-alice" });
    const response = await POST(makeRequest({ amountCents: 100_000_01 }));
    expect(response.status).toBe(400);
  });

  it("returns 404 when user has no pix key configured", async () => {
    serverMock.setUser({ id: "user-alice" });
    adminMock.onTable("users", {
      data: { pix_key_encrypted: null, name: "Alice" },
    });

    const response = await POST(makeRequest({ amountCents: 5000 }));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Voce nao tem chave Pix configurada");
  });

  it("returns 500 when decryption fails", async () => {
    serverMock.setUser({ id: "user-alice" });
    adminMock.onTable("users", {
      data: { pix_key_encrypted: "bad-crypto", name: "Alice" },
    });

    vi.mocked(decryptPixKey).mockImplementationOnce(() => {
      throw new Error("corrupted key");
    });

    const response = await POST(makeRequest({ amountCents: 5000 }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Erro ao processar sua chave Pix");
  });

  it("returns 200 with copiaECola on success", async () => {
    serverMock.setUser({ id: "user-alice" });
    adminMock.onTable("users", {
      data: { pix_key_encrypted: "valid-encrypted", name: "Alice Santos" },
    });

    const response = await POST(makeRequest({ amountCents: 4500 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("copiaECola");
    expect(body.copiaECola).toBe("00020126580014br.gov.bcb.pix...self");
  });

  it("sets Cache-Control private, no-store on the success response", async () => {
    serverMock.setUser({ id: "user-alice" });
    adminMock.onTable("users", {
      data: { pix_key_encrypted: "valid-encrypted", name: "Alice Santos" },
    });

    const response = await POST(makeRequest({ amountCents: 4500 }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("sets Cache-Control private, no-store on error responses", async () => {
    serverMock.setUser({ id: "user-alice" });
    adminMock.onTable("users", {
      data: { pix_key_encrypted: null, name: "Alice" },
    });

    const response = await POST(makeRequest({ amountCents: 5000 }));
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
