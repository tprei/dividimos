import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

  it("is a no-op when RATE_LIMIT_DISABLED=1 outside production", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "1");
    vi.stubEnv("NODE_ENV", "test");
    const { enforceRateLimit } = await import("@/lib/rate-limit");

    await expect(enforceRateLimit("users.lookup", "user-123")).resolves.toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("still calls the RPC when RATE_LIMIT_DISABLED=1 but NODE_ENV=production", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "1");
    vi.stubEnv("NODE_ENV", "production");
    mockRpc.mockResolvedValue({ data: 1, error: null });

    const { enforceRateLimit } = await import("@/lib/rate-limit");
    await expect(enforceRateLimit("users.lookup", "user-123")).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledOnce();
  });

  it("calls increment_rate_limit RPC and returns void on success", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "");
    mockRpc.mockResolvedValue({ data: 1, error: null });

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

  it("throws RateLimitExceeded (AppError RATE_LIMIT_EXCEEDED) when RPC raises rate_limited", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "");
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "rate_limited: 30 per 60 seconds exceeded" },
    });

    const { enforceRateLimit } = await import("@/lib/rate-limit");
    const { AppError } = await import("@/lib/errors");

    await expect(enforceRateLimit("voice.parse", "user-xyz")).rejects.toThrow(AppError);
    await expect(enforceRateLimit("voice.parse", "user-xyz")).rejects.toMatchObject({
      code: "RATE_LIMIT_EXCEEDED",
      statusCode: 429,
    });
  });

  it("throws INTERNAL_ERROR on non-rate-limit RPC failure", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "");
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "connection timeout" },
    });

    const { enforceRateLimit } = await import("@/lib/rate-limit");
    const { AppError } = await import("@/lib/errors");

    await expect(enforceRateLimit("pix.generate", "user-xyz")).rejects.toThrow(AppError);
    await expect(enforceRateLimit("pix.generate", "user-xyz")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("passes correct config for pix.generate-self bucket", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "");
    mockRpc.mockResolvedValue({ data: 1, error: null });

    const { enforceRateLimit } = await import("@/lib/rate-limit");
    await enforceRateLimit("pix.generate-self", "user-def");

    expect(mockRpc).toHaveBeenCalledWith("increment_rate_limit", {
      p_bucket:         "pix.generate-self",
      p_subject:        "user-def",
      p_limit:          60,
      p_window_seconds: 60,
    });
  });

  it("passes correct config for receipt.sefaz bucket (lower limit)", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "");
    mockRpc.mockResolvedValue({ data: 1, error: null });

    const { enforceRateLimit } = await import("@/lib/rate-limit");
    await enforceRateLimit("receipt.sefaz", "user-ghi");

    expect(mockRpc).toHaveBeenCalledWith("increment_rate_limit", {
      p_bucket:         "receipt.sefaz",
      p_subject:        "user-ghi",
      p_limit:          10,
      p_window_seconds: 60,
    });
  });

  it("passes correct config for push.send-pair bucket", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "");
    mockRpc.mockResolvedValue({ data: 1, error: null });

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
