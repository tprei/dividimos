import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /.well-known/apple-app-site-association", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves the association JSON for a valid App ID prefix", async () => {
    vi.stubEnv("APPLE_APP_ID_PREFIX", "A1B2C3D4E5");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["A1B2C3D4E5.ai.dividimos.app"],
            components: [
              { "/": "/join/*" },
              { "/": "/claim" },
              { "/": "/u/*" },
              { "/": "/room/*" },
            ],
          },
        ],
      },
    });
  });

  it("returns 404 without a prefix", async () => {
    vi.stubEnv("APPLE_APP_ID_PREFIX", "");

    const response = await GET();

    expect(response.status).toBe(404);
  });

  it.each(["a1b2c3d4e5", "A1B2C3D4E", "A1B2C3D4E56", "A1B2C3D4E6 "])("returns 404 for a %s prefix", async (prefix) => {
    vi.stubEnv("APPLE_APP_ID_PREFIX", prefix);

    const response = await GET();

    expect(response.status).toBe(404);
  });
});
