import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppleCredentialError, registerAppleCredential } from "./apple-credential";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("registerAppleCredential", () => {
  it("posts the authorization code and resolves on success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(registerAppleCredential("code-1")).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/apple/credential");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ authorizationCode: "code-1" });
  });

  it("throws the typed error with the server's stable code on refusal", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, code: "apple_identity_mismatch" }), { status: 403 }),
    );

    const thrown = await registerAppleCredential("code-2").catch(
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(AppleCredentialError);
    const failure = thrown as AppleCredentialError;
    expect(failure.code).toBe("apple_identity_mismatch");
    expect(failure.status).toBe(403);
  });

  it("maps a network failure to the retryable unavailable code", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    await expect(registerAppleCredential("code-3")).rejects.toMatchObject({
      name: "AppleCredentialError",
      code: "apple_unavailable",
      status: 0,
    });
  });

  it("falls back to unavailable when the failure body is not the contract", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }));

    await expect(registerAppleCredential("code-4")).rejects.toMatchObject({
      name: "AppleCredentialError",
      code: "apple_unavailable",
      status: 502,
    });
  });
});
