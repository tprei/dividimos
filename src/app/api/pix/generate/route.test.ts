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
  vi.mocked(decryptPixKey).mockClear();
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/pix/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Both alice and bob are accepted members of group-1. */
function setupAcceptedMembers() {
  serverMock.setUser({ id: "user-alice" });
  adminMock.onTable("group_members", {
    data: [{ user_id: "user-alice" }, { user_id: "user-bob" }],
  });
}

/** Balance rows where alice owes bob amountCents (net negative for debtor, positive for creditor). */
function balanceOwedByAlice(amountCents: number) {
  adminMock.onTable("group_balances", {
    data: [
      { kind: "user", participant_id: "user-alice", net_cents: -amountCents },
      { kind: "user", participant_id: "user-bob", net_cents: amountCents },
    ],
  });
}

function bobHasKey() {
  adminMock.onTable("users", {
    data: { pix_key_encrypted: "encrypted-key", name: "Bob" },
  });
}

describe("POST /api/pix/generate", () => {
  it("returns 401 when not authenticated", async () => {
    const response = await POST(
      makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 with invalid data", async () => {
    serverMock.setUser({ id: "user-alice" });
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Dados inválidos");
  });

  it("returns 400 when groupId is not provided", async () => {
    serverMock.setUser({ id: "user-alice" });
    const response = await POST(
      makeRequest({ recipientUserId: "user-bob", amountCents: 5000 }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when amountCents is 0 or negative", async () => {
    serverMock.setUser({ id: "user-alice" });
    const response = await POST(
      makeRequest({ recipientUserId: "user-bob", amountCents: 0, groupId: "group-1" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when amountCents is not an integer", async () => {
    serverMock.setUser({ id: "user-alice" });
    const response = await POST(
      makeRequest({ recipientUserId: "user-bob", amountCents: 50.5, groupId: "group-1" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when amountCents exceeds R$100,000 cap", async () => {
    serverMock.setUser({ id: "user-alice" });
    const response = await POST(
      makeRequest({ recipientUserId: "user-bob", amountCents: 100_000_01, groupId: "group-1" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when amountCents is Number.MAX_SAFE_INTEGER", async () => {
    serverMock.setUser({ id: "user-alice" });
    const response = await POST(
      makeRequest({
        recipientUserId: "user-bob",
        amountCents: Number.MAX_SAFE_INTEGER,
        groupId: "group-1",
      }),
    );
    expect(response.status).toBe(400);
  });

  describe("group settlement flow", () => {
    it("returns 403 when users are not in the same group", async () => {
      serverMock.setUser({ id: "user-alice" });
      adminMock.onTable("group_members", {
        data: [{ user_id: "user-alice" }],
      });

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Acesso negado");
    });

    it("allows group member across a real payable edge", async () => {
      setupAcceptedMembers();
      balanceOwedByAlice(5000);
      bobHasKey();

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 3000, groupId: "group-1" }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("copiaECola");
    });
  });

  it("returns 500 when pix key decryption fails", async () => {
    setupAcceptedMembers();
    balanceOwedByAlice(5000);
    adminMock.onTable("users", {
      data: { pix_key_encrypted: "corrupted-data", name: "Bob Santos" },
    });

    vi.mocked(decryptPixKey).mockImplementationOnce(() => {
      throw new Error("Invalid encryption payload");
    });

    const response = await POST(
      makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("chave Pix");
  });

  describe("payable-edge guard", () => {
    it("denies a co-member with no balance row", async () => {
      setupAcceptedMembers();
      adminMock.onTable("group_balances", { data: null });

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      expect(response.status).toBe(403);
      // The encrypted key is never read when authorization does not resolve.
      expect(adminMock.findCalls("users")).toHaveLength(0);
      expect(decryptPixKey).not.toHaveBeenCalled();
    });

    it("denies a settled (zero) balance", async () => {
      setupAcceptedMembers();
      balanceOwedByAlice(0);

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      expect(response.status).toBe(403);
      expect(adminMock.findCalls("users")).toHaveLength(0);
      expect(decryptPixKey).not.toHaveBeenCalled();
    });

    it("denies when the recipient is the net debtor (wrong direction)", async () => {
      setupAcceptedMembers();
      // negative amount_cents = user_b (bob) owes user_a (alice) — bob is the debtor
      balanceOwedByAlice(-5000);

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      expect(response.status).toBe(403);
      expect(adminMock.findCalls("users")).toHaveLength(0);
      expect(decryptPixKey).not.toHaveBeenCalled();
    });

    it("denies when the requested amount exceeds the outstanding edge", async () => {
      setupAcceptedMembers();
      balanceOwedByAlice(3000);

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      expect(response.status).toBe(403);
      expect(adminMock.findCalls("users")).toHaveLength(0);
      expect(decryptPixKey).not.toHaveBeenCalled();
    });

    it("allows an amount up to the outstanding edge (partial payment)", async () => {
      setupAcceptedMembers();
      balanceOwedByAlice(5000);
      bobHasKey();

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      expect(response.status).toBe(200);
    });

    it("allows self-collection (caller's own key) with no payable edge", async () => {
      serverMock.setUser({ id: "user-alice" });
      adminMock.onTable("group_members", { data: [{ user_id: "user-alice" }] });
      adminMock.onTable("users", {
        data: { pix_key_encrypted: "encrypted-key", name: "Alice" },
      });

      const response = await POST(
        makeRequest({ recipientUserId: "user-alice", amountCents: 5000, groupId: "group-1" }),
      );

      expect(response.status).toBe(200);
      // self-collection skips the balance read entirely
      expect(adminMock.findCalls("group_balances")).toHaveLength(0);
    });

    it("returns a byte-identical body for every pre-edge denial", async () => {
      const deniedBody = JSON.stringify({ error: "Acesso negado" });

      // not same group
      // not same group
      serverMock.setUser({ id: "user-alice" });
      adminMock.onTable("group_members", { data: [{ user_id: "user-alice" }] });
      const notMember = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      // no balance
      setupAcceptedMembers();
      adminMock.onTable("group_balances", { data: null });
      const noBalance = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      // wrong direction
      setupAcceptedMembers();
      balanceOwedByAlice(-5000);
      const wrongDirection = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      // over-amount
      setupAcceptedMembers();
      balanceOwedByAlice(3000);
      const overAmount = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      for (const res of [notMember, noBalance, wrongDirection, overAmount]) {
        expect(res.status).toBe(403);
        expect(JSON.stringify(await res.json())).toBe(deniedBody);
      }
    });
  });

  describe("cache headers", () => {
    it("sets Cache-Control: private, no-store on success", async () => {
      setupAcceptedMembers();
      balanceOwedByAlice(5000);
      bobHasKey();

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 3000, groupId: "group-1" }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    });

    it("sets Cache-Control: private, no-store on denial", async () => {
      serverMock.setUser({ id: "user-alice" });
      adminMock.onTable("group_members", { data: [] });

      const response = await POST(
        makeRequest({ recipientUserId: "user-bob", amountCents: 5000, groupId: "group-1" }),
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    });

    it("sets Cache-Control: private, no-store on bad input", async () => {
      serverMock.setUser({ id: "user-alice" });
      const response = await POST(makeRequest({}));
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    });
  });
});
