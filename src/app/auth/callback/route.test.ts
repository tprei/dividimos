import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  });
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe("OAuth callback", () => {
  it("sends a successful exchange to the continuation page", async () => {
    const response = await GET(
      new Request(
        "https://dividimos.test/auth/callback?code=oauth-code&next=%2Finvite%3Ftoken%3Dabc",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://dividimos.test/auth/continue?next=%2Finvite%3Ftoken%3Dabc",
    );
  });

  it("keeps code exchange failures on the callback error path", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("exchange failed") });

    const response = await GET(
      new Request("https://dividimos.test/auth/callback?code=oauth-code&next=%2Fapp"),
    );

    expect(response.headers.get("location")).toBe(
      "https://dividimos.test/auth?error=callback_failed",
    );
  });

  it("does not replay a callback without a code", async () => {
    const response = await GET(
      new Request("https://dividimos.test/auth/callback?next=%2Fapp"),
    );

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://dividimos.test/auth?error=callback_failed",
    );
  });
});
