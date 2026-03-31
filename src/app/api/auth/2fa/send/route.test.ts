import { describe, it, expect } from "vitest";
import { POST } from "./route";

describe("POST /api/auth/2fa/send", () => {
  it("returns 410 Gone since 2FA is removed", async () => {
    const response = await POST();
    expect(response.status).toBe(410);
  });
});
