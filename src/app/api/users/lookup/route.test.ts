import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

vi.mock("server-only", () => ({}));

const mockLookupProfile = vi.fn();
vi.mock("@/lib/profile-lookup", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    lookupProfile: (...args: unknown[]) => mockLookupProfile(...args),
  };
});

import { GET } from "./route";

const PROFILE = { id: "user-bob", handle: "bob", name: "Bob Santos", avatarUrl: null };

beforeEach(() => {
  mockLookupProfile.mockReset();
});

function lookupRequest(handle?: string): Request {
  const query = handle === undefined ? "" : `?handle=${encodeURIComponent(handle)}`;
  return new Request(`http://localhost/api/users/lookup${query}`);
}

describe("GET /api/users/lookup", () => {
  it("returns the resolved profile", async () => {
    mockLookupProfile.mockResolvedValueOnce(PROFILE);

    const response = await GET(lookupRequest("bob"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: PROFILE });
  });

  it("delegates the raw query parameter to the lookup boundary", async () => {
    mockLookupProfile.mockResolvedValueOnce(null);
    await GET(lookupRequest(" Bob "));

    expect(mockLookupProfile).toHaveBeenCalledExactlyOnceWith(" Bob ");
  });

  it("returns 404 when the handle resolves to no onboarded profile", async () => {
    mockLookupProfile.mockResolvedValueOnce(null);

    const response = await GET(lookupRequest("nobody"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Usuário não encontrado" });
  });

  it("publishes 401 for an unauthenticated caller", async () => {
    mockLookupProfile.mockRejectedValueOnce(new AppError("AUTH_UNAUTHORIZED", "Não autenticado"));

    const response = await GET(lookupRequest("bob"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Não autenticado" });
  });

  it("publishes 400 for an empty handle", async () => {
    mockLookupProfile.mockRejectedValueOnce(new AppError("USER_INVALID_HANDLE", "Handle obrigatorio"));

    const response = await GET(lookupRequest("%20%20"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Handle obrigatorio" });
  });

  it("publishes 429 when the bucket is saturated", async () => {
    mockLookupProfile.mockRejectedValueOnce(
      new AppError("RATE_LIMIT_EXCEEDED", "Muitas requisições. Tente novamente em alguns segundos."),
    );

    const response = await GET(lookupRequest("bob"));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Muitas requisições. Tente novamente em alguns segundos.",
    });
  });

  it("publishes 503 when the boundary fails closed", async () => {
    mockLookupProfile.mockRejectedValueOnce(
      new AppError("RATE_LIMIT_UNAVAILABLE", "Serviço temporariamente indisponível"),
    );

    const response = await GET(lookupRequest("bob"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Serviço temporariamente indisponível" });
  });

  it("lets errors outside the lookup contract surface", async () => {
    mockLookupProfile.mockRejectedValueOnce(new Error("boom"));

    await expect(GET(lookupRequest("bob"))).rejects.toThrow("boom");
  });
});
