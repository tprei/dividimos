import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "@/test/mock-supabase";
import { AppError } from "@/lib/errors";

const adminMock = createMockSupabase();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => adminMock.client),
}));

const mockEnforceRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
}));

import { POST } from "./route";

const RPC = "rpc:resolve_assignment_room_code";
const ROOM_ID = "00000000-0000-4000-8000-000000000001";

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new Request("http://localhost/api/room-code", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function codeRequest(
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  return makeRequest(
    {
      code: "pipoca-moleza",
      grantToken: `armr1_${"A".repeat(43)}`,
      ...overrides,
    },
    headers
  );
}

beforeEach(() => {
  adminMock.reset();
  mockEnforceRateLimit.mockReset();
  mockEnforceRateLimit.mockResolvedValue(undefined);
});

describe("POST /api/room-code", () => {
  it("spends the room-code bucket for the first forwarded address", async () => {
    adminMock.onRpc("resolve_assignment_room_code", { data: { roomId: ROOM_ID } });

    const response = await POST(
      codeRequest({}, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" })
    );

    expect(response.status).toBe(200);
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      "room-code.resolve",
      "ip:203.0.113.7"
    );
  });

  it("shares one bucket across a client's IPv6 /64 and unwraps mapped IPv4", async () => {
    adminMock.onRpc("resolve_assignment_room_code", { data: { roomId: ROOM_ID } });

    await POST(codeRequest({}, { "x-forwarded-for": "2001:db8:0:1::5" }));
    await POST(codeRequest({}, { "x-forwarded-for": "2001:0db8:0000:0001:ffff:1:2:3" }));
    await POST(codeRequest({}, { "x-forwarded-for": "::ffff:198.51.100.4" }));

    expect(mockEnforceRateLimit.mock.calls.map(([, subject]) => subject)).toEqual([
      "ip:2001:db8:0:1::/64",
      "ip:2001:db8:0:1::/64",
      "ip:198.51.100.4",
    ]);
  });

  it("fails closed in production when no forwarded address is present", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const response = await POST(codeRequest());

      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("room_code_unavailable");
      expect(mockEnforceRateLimit).not.toHaveBeenCalled();
      expect(adminMock.findCalls(RPC)).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns 400 without calling the limiter or RPC for a malformed grant", async () => {
    const response = await POST(codeRequest({ grantToken: "armr1_short" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_argument");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(adminMock.findCalls(RPC)).toHaveLength(0);
  });

  it("returns 404 without calling the limiter for a non-code string", async () => {
    const response = await POST(codeRequest({ code: "pipoca" }));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_room_code");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(adminMock.findCalls(RPC)).toHaveLength(0);
  });

  it("returns 400 for a body without code and grantToken strings", async () => {
    const response = await POST(makeRequest({ code: 42 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_argument");
    expect(adminMock.findCalls(RPC)).toHaveLength(0);
  });

  it("returns 429 room_code_rate_limited when the bucket is saturated", async () => {
    mockEnforceRateLimit.mockRejectedValueOnce(
      new AppError("RATE_LIMIT_EXCEEDED", "limite")
    );

    const response = await POST(codeRequest());

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("room_code_rate_limited");
    expect(body.error.message).toBe(
      "Muitas tentativas de código. Espere uns minutos e tente de novo."
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(adminMock.findCalls(RPC)).toHaveLength(0);
  });

  it("returns 503 room_code_unavailable when the limiter is unavailable", async () => {
    mockEnforceRateLimit.mockRejectedValueOnce(
      new AppError("RATE_LIMIT_UNAVAILABLE", "indisponível")
    );

    const response = await POST(codeRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("room_code_unavailable");
    expect(adminMock.findCalls(RPC)).toHaveLength(0);
  });

  it("maps an RPC error message to its ledger code and status", async () => {
    adminMock.onRpc("resolve_assignment_room_code", {
      data: null,
      error: { message: "invalid_room_code" },
    });

    const response = await POST(codeRequest());

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_room_code");
    expect(body.error.message).toBe(
      "Esse código não existe ou já expirou. Confere com quem criou a sala."
    );
  });

  it("returns the resolved roomId with no-store caching on success", async () => {
    adminMock.onRpc("resolve_assignment_room_code", { data: { roomId: ROOM_ID } });

    const response = await POST(codeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ roomId: ROOM_ID });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(adminMock.findCalls(RPC)[0]?.args).toEqual([
      "resolve_assignment_room_code",
      { p_code: "pipoca-moleza", p_grant_token: `armr1_${"A".repeat(43)}` },
    ]);
  });
});
