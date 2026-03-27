import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "@/test/mock-supabase";

// Mock Supabase server client (auth + queries)
const serverMock = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

// Mock Supabase admin client (bypasses RLS for key decryption)
const adminMock = createMockSupabase();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => adminMock.client),
}));

// Mock crypto + pix generation
vi.mock("@/lib/crypto", () => ({
  decryptPixKey: vi.fn(() => "decrypted-pix-key@example.com"),
}));

vi.mock("@/lib/pix", () => ({
  generatePixCopiaECola: vi.fn(() => "00020126580014br.gov.bcb.pix...test"),
}));

import { decryptPixKey } from "@/lib/crypto";
import { POST } from "./route";

beforeEach(() => {
  serverMock.reset();
  adminMock.reset();
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/pix/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pix/generate", () => {
  it("returns 401 when not authenticated", async () => {
    const response = await POST(
      makeRequest({ recipientUserId: "user-bob", amountCents: 5000, billId: "bill-1" }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Nao autenticado");
  });

  it("returns 400 with invalid data", async () => {
    serverMock.setUser({ id: "user-alice" });

    // Missing required fields
    const response = await POST(makeRequest({ recipientUserId: "user-bob" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Dados invalidos");
  });

  it("returns 400 when neither billId nor groupId is provided", async () => {
    serverMock.setUser({ id: "user-alice" });

    const response = await POST(
      makeRequest({ recipientUserId: "user-bob", amountCents: 5000 }),
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when amountCents is 0 or negative", async () => {
    serverMock.setUser({ id: "user-alice" });

    const response = await POST(
      makeRequest({ recipientUserId: "user-bob", amountCents: 0, billId: "bill-1" }),
    );

    expect(response.status).toBe(400);
  });

  describe("bill settlement flow", () => {
    it("returns 403 when caller is not a bill participant or creator", async () => {
      serverMock.setUser({ id: "user-eve" });

      // bill_participants.select → no match
      serverMock.onTable("bill_participants", { data: [] });
      // bills.select for creator check → different creator
      serverMock.onTable("bills", { data: { creator_id: "user-alice" } });

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, billId: "bill-1" }),
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("nao participam");
    });

    it("returns 403 when recipient has not accepted the invite", async () => {
      serverMock.setUser({ id: "user-alice" });

      // Both are participants; bob has not accepted
      serverMock.onTable("bill_participants", {
        data: [
          { user_id: "user-alice", status: "accepted" },
          { user_id: "user-bob", status: "invited" },
        ],
      });

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, billId: "bill-1" }),
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("nao aceitou");
    });

    it("returns 404 when recipient has no pix key", async () => {
      serverMock.setUser({ id: "user-alice" });

      serverMock.onTable("bill_participants", {
        data: [{ user_id: "user-alice" }, { user_id: "user-bob" }],
      });
      serverMock.onTable("bill_participants", {
        data: { status: "accepted" },
      });

      // Admin query for recipient pix key → null
      adminMock.onTable("users", { data: { pix_key_encrypted: null, name: "Bob" } });

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, billId: "bill-1" }),
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain("sem chave Pix");
    });

    it("returns copiaECola on successful bill settlement", async () => {
      serverMock.setUser({ id: "user-alice" });

      serverMock.onTable("bill_participants", {
        data: [{ user_id: "user-alice" }, { user_id: "user-bob" }],
      });
      serverMock.onTable("bill_participants", {
        data: { status: "accepted" },
      });

      adminMock.onTable("users", {
        data: { pix_key_encrypted: "encrypted-key", name: "Bob Santos" },
      });

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, billId: "bill-1" }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.copiaECola).toBe("00020126580014br.gov.bcb.pix...test");
    });
  });

  describe("group settlement flow", () => {
    it("returns 403 when users are not in the same group", async () => {
      serverMock.setUser({ id: "user-alice" });

      // group_members → only alice
      serverMock.onTable("group_members", {
        data: [{ user_id: "user-alice" }],
      });
      // groups.select → creator
      serverMock.onTable("groups", { data: { creator_id: "user-other" } });

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("nao pertencem ao mesmo grupo");
    });

    it("allows group creator who is not a member row", async () => {
      serverMock.setUser({ id: "user-alice" });

      // group_members → only bob (alice is creator, not in members table)
      serverMock.onTable("group_members", {
        data: [{ user_id: "user-bob" }],
      });
      serverMock.onTable("groups", { data: { creator_id: "user-alice" } });

      adminMock.onTable("users", {
        data: { pix_key_encrypted: "encrypted-key", name: "Bob" },
      });

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 3000, groupId: "group-1" }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("copiaECola");
    });
  });

  it("returns 500 when pix key decryption fails", async () => {
    serverMock.setUser({ id: "user-alice" });

    serverMock.onTable("bill_participants", {
      data: [{ user_id: "user-alice" }, { user_id: "user-bob" }],
    });
    serverMock.onTable("bill_participants", {
      data: { status: "accepted" },
    });

    adminMock.onTable("users", {
      data: { pix_key_encrypted: "corrupted-data", name: "Bob Santos" },
    });

    vi.mocked(decryptPixKey).mockImplementationOnce(() => {
      throw new Error("Invalid encryption payload");
    });

    const response = await POST(
      makeRequest({ recipientUserId: "user-bob", amountCents: 5000, billId: "bill-1" }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("chave Pix");
  });
});
