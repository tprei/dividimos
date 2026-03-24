import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { GET } from "./route";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockResolvedValue(mock.client);
});

describe("GET /api/users/lookup", () => {
  it("returns 401 when not authenticated", async () => {
    const request = new Request("http://localhost/api/users/lookup?handle=alice");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Nao autenticado");
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
    mock.onTable("user_profiles", { data: null });

    const request = new Request("http://localhost/api/users/lookup?handle=nobody");
    const response = await GET(request);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Usuario nao encontrado");
  });

  it("returns profile on success", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onTable("user_profiles", {
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

  it("normalizes handle to lowercase and trims whitespace", async () => {
    mock.setUser({ id: "user-alice" });
    mock.onTable("user_profiles", { data: { id: "user-bob", handle: "bob", name: "Bob" } });

    const request = new Request("http://localhost/api/users/lookup?handle=%20BOB%20");
    await GET(request);

    const eqCalls = mock.findCalls("user_profiles", "eq");
    expect(eqCalls).toHaveLength(1);
    expect(eqCalls[0].args).toEqual(["handle", "bob"]);
  });
});
