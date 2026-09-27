import { afterEach, describe, expect, it, vi } from "vitest";
import { LedgerError } from "@/lib/sync/errors";
import { reportContent } from "@/lib/sync/reports";

const UUID = "6f1a2b3c-4d5e-4f60-8a71-9b0c1d2e3f40";
const input = { targetUserId: UUID, messageId: null, reason: "assedio" as const, details: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reportContent", () => {
  it("returns the report id and delivered flag from a valid response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ reportId: UUID, delivered: true }),
      { status: 200 },
    )));
    await expect(reportContent(input)).resolves.toEqual({
      reportId: UUID,
      delivered: true,
    });
  });

  it("maps a non-JSON error response to invalid_wire", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "<html>gateway timeout</html>",
      { status: 504 },
    )));
    try {
      await reportContent(input);
      expect.unreachable("reportContent should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerError);
      expect((error as LedgerError).code).toBe("invalid_wire");
    }
  });

  it("passes the server error code through as a LedgerError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: "not_a_member", message: "Você não faz parte desse grupo." } }),
      { status: 403 },
    )));
    try {
      await reportContent(input);
      expect.unreachable("reportContent should have thrown");
    } catch (error) {
      expect((error as LedgerError).code).toBe("not_a_member");
    }
  });

  it("maps a fetch transport failure to network", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    try {
      await reportContent(input);
      expect.unreachable("reportContent should have thrown");
    } catch (error) {
      expect((error as LedgerError).code).toBe("network");
    }
  });

  it("rejects a malformed success payload as invalid_wire", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ reportId: "não-é-um-uuid", delivered: true }),
      { status: 200 },
    )));
    try {
      await reportContent(input);
      expect.unreachable("reportContent should have thrown");
    } catch (error) {
      expect((error as LedgerError).code).toBe("invalid_wire");
    }
  });
});
