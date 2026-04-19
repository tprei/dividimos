import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /.well-known/apple-app-site-association", () => {
  it("returns valid AASA JSON", async () => {
    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({
      applinks: {
        apps: [],
        details: [
          {
            appIDs: ["TEAMID.ai.dividimos.app"],
            paths: ["/auth/native-complete*"],
          },
        ],
      },
    });
  });

  it("returns application/json content type", async () => {
    const response = await GET();

    expect(response.headers.get("Content-Type")).toBe("application/json");
  });
});
