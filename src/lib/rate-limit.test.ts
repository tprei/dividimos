import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AppError } from "@/lib/errors";

vi.mock("server-only", () => ({}));

const mockRpc = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mockRpc,
  }),
}));

describe("enforceRateLimit", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRpc.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("test bypass", () => {
    it("is a no-op when RATE_LIMIT_DISABLED=1, NODE_ENV=test, and VITEST=true", async () => {
      vi.stubEnv("RATE_LIMIT_DISABLED", "1");
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("VITEST", "true");
      const { enforceRateLimit } = await import("@/lib/rate-limit");

      await expect(enforceRateLimit("users.lookup", "user-123")).resolves.toBeUndefined();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("still calls the RPC when VITEST is not set (production-like NODE_ENV=test server)", async () => {
      vi.stubEnv("RATE_LIMIT_DISABLED", "1");
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("VITEST", "");
      mockRpc.mockResolvedValueOnce({ data: true, error: null });

      const { enforceRateLimit } = await import("@/lib/rate-limit");
      await expect(enforceRateLimit("users.lookup", "user-123")).resolves.toBeUndefined();
      expect(mockRpc).toHaveBeenCalledOnce();
    });

    it("still calls the RPC when NODE_ENV=production even with RATE_LIMIT_DISABLED=1 and VITEST=true", async () => {
      vi.stubEnv("RATE_LIMIT_DISABLED", "1");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("VITEST", "true");
      mockRpc.mockResolvedValueOnce({ data: true, error: null });

      const { enforceRateLimit } = await import("@/lib/rate-limit");
      await expect(enforceRateLimit("users.lookup", "user-123")).resolves.toBeUndefined();
      expect(mockRpc).toHaveBeenCalledOnce();
    });

    it("still calls the RPC when RATE_LIMIT_DISABLED is not '1'", async () => {
      vi.stubEnv("RATE_LIMIT_DISABLED", "0");
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("VITEST", "true");
      mockRpc.mockResolvedValueOnce({ data: true, error: null });

      const { enforceRateLimit } = await import("@/lib/rate-limit");
      await expect(enforceRateLimit("users.lookup", "user-123")).resolves.toBeUndefined();
      expect(mockRpc).toHaveBeenCalledOnce();
    });

    it("cannot hide an invalid subject: invalid identity fails before bypass is evaluated", async () => {
      vi.stubEnv("RATE_LIMIT_DISABLED", "1");
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("VITEST", "true");
      const { enforceRateLimit } = await import("@/lib/rate-limit");
      const { AppError } = await import("@/lib/errors");

      await expect(enforceRateLimit("users.lookup", "")).rejects.toMatchObject({
        code: "RATE_LIMIT_UNAVAILABLE",
      });
      await expect(enforceRateLimit("users.lookup", "")).rejects.toBeInstanceOf(AppError);
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

  describe("boolean RPC contract", () => {
    beforeEach(() => {
      vi.stubEnv("RATE_LIMIT_DISABLED", "0");
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("VITEST", "true");
    });

    it("returns void when the RPC resolves data:true", async () => {
      mockRpc.mockResolvedValueOnce({ data: true, error: null });
      const { enforceRateLimit } = await import("@/lib/rate-limit");

      await expect(enforceRateLimit("users.lookup", "user-abc")).resolves.toBeUndefined();
      expect(mockRpc).toHaveBeenCalledOnce();
      expect(mockRpc).toHaveBeenCalledWith("increment_rate_limit", {
        p_bucket:         "users.lookup",
        p_subject:        "user-abc",
        p_limit:          30,
        p_window_seconds: 60,
      });
    });

    it("throws RATE_LIMIT_EXCEEDED (429) when the RPC resolves data:false", async () => {
      mockRpc.mockResolvedValueOnce({ data: false, error: null });
      const { enforceRateLimit } = await import("@/lib/rate-limit");
      const { AppError } = await import("@/lib/errors");

      await expect(enforceRateLimit("voice.parse", "user-xyz")).rejects.toThrow(AppError);
      mockRpc.mockResolvedValueOnce({ data: false, error: null });
      await expect(enforceRateLimit("voice.parse", "user-xyz")).rejects.toMatchObject({
        code: "RATE_LIMIT_EXCEEDED",
        statusCode: 429,
      });
    });

    it.each([
      ["an RPC error", { data: null, error: { message: "boom" } }],
      ["a null result with no error", { data: null, error: null }],
      ["a numeric result", { data: 1, error: null }],
      ["a string result", { data: "true", error: null }],
      ["an object result", { data: {}, error: null }],
      ["a missing data key entirely", { error: null }],
    ])("throws RATE_LIMIT_UNAVAILABLE (503) for %s", async (_label, mocked) => {
      mockRpc.mockResolvedValueOnce(mocked);
      const { enforceRateLimit } = await import("@/lib/rate-limit");

      await expect(enforceRateLimit("pix.generate", "user-xyz")).rejects.toMatchObject({
        code: "RATE_LIMIT_UNAVAILABLE",
        statusCode: 503,
      });
    });

    it("throws RATE_LIMIT_UNAVAILABLE (503) when the RPC promise rejects", async () => {
      mockRpc.mockRejectedValueOnce(new Error("connection refused"));
      const { enforceRateLimit } = await import("@/lib/rate-limit");

      await expect(enforceRateLimit("pix.generate", "user-xyz")).rejects.toMatchObject({
        code: "RATE_LIMIT_UNAVAILABLE",
        statusCode: 503,
      });
    });

    it("never leaks raw RPC/database diagnostics into the thrown error", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "connection to postgresql://user:secret@host failed" },
      });
      const { enforceRateLimit } = await import("@/lib/rate-limit");

      try {
        await enforceRateLimit("pix.generate", "user-xyz");
        expect.unreachable();
      } catch (error) {
        const serialized = JSON.stringify(error instanceof Error ? { ...error, message: error.message } : error);
        expect(serialized).not.toContain("postgresql://");
        expect(serialized).not.toContain("secret");
      }
    });

    it("fails closed for a runtime-unknown bucket before touching config.limit or the RPC", async () => {
      const { enforceRateLimit } = await import("@/lib/rate-limit");
      const unknownBucket = "not.a.real.bucket" as Parameters<typeof enforceRateLimit>[0];

      await expect(enforceRateLimit(unknownBucket, "user-abc")).rejects.toMatchObject({
        code: "RATE_LIMIT_UNAVAILABLE",
      });
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("fails closed for a blank subject before calling the RPC", async () => {
      const { enforceRateLimit } = await import("@/lib/rate-limit");

      await expect(enforceRateLimit("users.lookup", "   ")).rejects.toMatchObject({
        code: "RATE_LIMIT_UNAVAILABLE",
      });
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("fails closed for an overlong subject before calling the RPC", async () => {
      const { enforceRateLimit } = await import("@/lib/rate-limit");

      await expect(
        enforceRateLimit("users.lookup", "x".repeat(513)),
      ).rejects.toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("passes correct config and exact args for chat.parse", async () => {
      mockRpc.mockResolvedValueOnce({ data: true, error: null });
      const { enforceRateLimit } = await import("@/lib/rate-limit");
      await enforceRateLimit("chat.parse", "user-chat");

      expect(mockRpc).toHaveBeenCalledWith("increment_rate_limit", {
        p_bucket:         "chat.parse",
        p_subject:        "user-chat",
        p_limit:          30,
        p_window_seconds: 60,
      });
    });

    it("passes correct config and exact args for voice.parse", async () => {
      mockRpc.mockResolvedValueOnce({ data: true, error: null });
      const { enforceRateLimit } = await import("@/lib/rate-limit");
      await enforceRateLimit("voice.parse", "user-voice");

      expect(mockRpc).toHaveBeenCalledWith("increment_rate_limit", {
        p_bucket:         "voice.parse",
        p_subject:        "user-voice",
        p_limit:          30,
        p_window_seconds: 60,
      });
    });

    it("passes correct config for pix.generate-self bucket", async () => {
      mockRpc.mockResolvedValueOnce({ data: true, error: null });
      const { enforceRateLimit } = await import("@/lib/rate-limit");
      await enforceRateLimit("pix.generate-self", "user-def");

      expect(mockRpc).toHaveBeenCalledWith("increment_rate_limit", {
        p_bucket:         "pix.generate-self",
        p_subject:        "user-def",
        p_limit:          60,
        p_window_seconds: 60,
      });
    });


    it("passes correct config for push.send-pair bucket", async () => {
      mockRpc.mockResolvedValueOnce({ data: true, error: null });
      const { enforceRateLimit } = await import("@/lib/rate-limit");
      await enforceRateLimit("push.send-pair", "user-a:user-b");

      expect(mockRpc).toHaveBeenCalledWith("increment_rate_limit", {
        p_bucket:         "push.send-pair",
        p_subject:        "user-a:user-b",
        p_limit:          5,
        p_window_seconds: 60,
      });
    });
  });
});

describe("enforceAiBudget", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRpc.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op when RATE_LIMIT_DISABLED=1, NODE_ENV=test, and VITEST=true", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "1");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VITEST", "true");
    const { enforceAiBudget } = await import("@/lib/rate-limit");

    await expect(enforceAiBudget("user-123")).resolves.toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls consume_ai_request with the admin client and the user id", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "0");
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    const { enforceAiBudget } = await import("@/lib/rate-limit");

    await expect(enforceAiBudget("user-abc")).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledExactlyOnceWith("consume_ai_request", {
      p_user_id: "user-abc",
    });
  });

  it("throws RATE_LIMIT_EXCEEDED (429) with the daily copy when the RPC resolves data:false", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "0");
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    const { enforceAiBudget } = await import("@/lib/rate-limit");
    const { AppError } = await import("@/lib/errors");

    try {
      await enforceAiBudget("user-xyz");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(appError.statusCode).toBe(429);
      expect(appError.message).toBe(
        "Você usou o limite diário de leituras com IA. Tente de novo amanhã.",
      );
    }
  });

  it("throws ACCOUNT_DELETED (403) when the RPC reports account_deleted", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "0");
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "account_deleted" } });
    const { enforceAiBudget } = await import("@/lib/rate-limit");
    const { AppError } = await import("@/lib/errors");

    try {
      await enforceAiBudget("user-deleted");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("ACCOUNT_DELETED");
      expect(appError.statusCode).toBe(403);
      expect(appError.message).not.toContain("account_deleted");
    }
  });

  it("never leaks raw RPC diagnostics into the thrown error", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "0");
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "connection to postgresql://user:secret@host failed" },
    });
    const { enforceAiBudget } = await import("@/lib/rate-limit");

    try {
      await enforceAiBudget("user-xyz");
      expect.unreachable();
    } catch (error) {
      const serialized = JSON.stringify(error instanceof Error ? { ...error, message: error.message } : error);
      expect(serialized).not.toContain("postgresql://");
      expect(serialized).not.toContain("secret");
    }
  });

  it.each([
    ["an RPC error", { data: null, error: { message: "boom" } }],
    ["a null result with no error", { data: null, error: null }],
    ["a numeric result", { data: 1, error: null }],
    ["a string result", { data: "true", error: null }],
    ["a missing data key entirely", { error: null }],
  ])("throws RATE_LIMIT_UNAVAILABLE (503) for %s", async (_label, mocked) => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "0");
    mockRpc.mockResolvedValueOnce(mocked);
    const { enforceAiBudget } = await import("@/lib/rate-limit");

    await expect(enforceAiBudget("user-xyz")).rejects.toMatchObject({
      code: "RATE_LIMIT_UNAVAILABLE",
      statusCode: 503,
    });
  });

  it("throws RATE_LIMIT_UNAVAILABLE (503) when the RPC promise rejects", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "0");
    mockRpc.mockRejectedValueOnce(new Error("connection refused"));
    const { enforceAiBudget } = await import("@/lib/rate-limit");

    await expect(enforceAiBudget("user-xyz")).rejects.toMatchObject({
      code: "RATE_LIMIT_UNAVAILABLE",
      statusCode: 503,
    });
  });

  it("fails closed for a blank user id before calling the RPC", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "0");
    const { enforceAiBudget } = await import("@/lib/rate-limit");

    await expect(enforceAiBudget("   ")).rejects.toMatchObject({
      code: "RATE_LIMIT_UNAVAILABLE",
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("fails closed for an overlong user id before calling the RPC", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "0");
    const { enforceAiBudget } = await import("@/lib/rate-limit");

    await expect(enforceAiBudget("x".repeat(513))).rejects.toMatchObject({
      code: "RATE_LIMIT_UNAVAILABLE",
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
