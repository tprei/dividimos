import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";
import { AppError } from "@/lib/errors";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const mockEnforceRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
}));

import { createClient } from "@/lib/supabase/server";
import { GET } from "./route";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockResolvedValue(mock.client);
  mockEnforceRateLimit.mockReset();
  mockEnforceRateLimit.mockResolvedValue(undefined);
});

describe("GET /api/users/lookup", () => {
  it("returns 401 when not authenticated", async () => {
    const request = new Request("http://localhost/api/users/lookup?handle=alice");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Não autenticado");
  });

  it("returns 400 when handle is missing", async () => {
    mock.setUser({ id: "user-alice" });

    const request = new Request("http://localhost/api/users/lookup");
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Handle obrigatorio");
  });

  it("returns 404 when user is not found", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onRpc("lookup_user_by_handle", { data: null });

    const request = new Request("http://localhost/api/users/lookup?handle=nobody");
    const response = await GET(request);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Usuário não encontrado");
  });

  it("returns profile on success", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onRpc("lookup_user_by_handle", {
      data: {
        id: "user-bob",
        handle: "bob",
        name: "Bob Santos",
        avatar_url: "https://example.com/bob.jpg",
      },
    });

    const request = new Request("http://localhost/api/users/lookup?handle=Bob");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.profile).toMatchObject({
      id: "user-bob",
      handle: "bob",
      name: "Bob Santos",
    });
  });

  it("passes normalized handle to the RPC", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onRpc("lookup_user_by_handle", { data: { id: "user-bob", handle: "bob", name: "Bob" } });

    const request = new Request("http://localhost/api/users/lookup?handle=%20BOB%20");
    await GET(request);

    const rpcCalls = mock.findCalls("rpc:lookup_user_by_handle", "rpc");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args[1]).toEqual({ p_handle: "bob" });
  });

  it("spends the users.lookup bucket for the authenticated caller", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onRpc("lookup_user_by_handle", { data: { id: "user-bob", handle: "bob", name: "Bob" } });

    const request = new Request("http://localhost/api/users/lookup?handle=bob");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockEnforceRateLimit).toHaveBeenCalledExactlyOnceWith("users.lookup", "user-alice");
  });

  it("returns 429 without calling the lookup RPC when the bucket is saturated", async () => {
    mock.setUser({ id: "user-alice" });
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_EXCEEDED", "Muitas requisições. Tente novamente em alguns segundos.", {
        statusCode: 429,
      }),
    );

    const request = new Request("http://localhost/api/users/lookup?handle=bob");
    const response = await GET(request);

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe("Muitas requisições. Tente novamente em alguns segundos.");
    expect(mock.findCalls("rpc:lookup_user_by_handle", "rpc")).toHaveLength(0);
  });
});
