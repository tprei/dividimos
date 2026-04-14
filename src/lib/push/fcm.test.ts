import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

class MockSignJWT {
  setProtectedHeader() { return this; }
  setIssuer() { return this; }
  setSubject() { return this; }
  setAudience() { return this; }
  setIssuedAt() { return this; }
  setExpirationTime() { return this; }
  async sign() { return "mock-jwt-assertion"; }
}

vi.mock("jose", () => ({
  importPKCS8: vi.fn().mockResolvedValue("mock-key"),
  SignJWT: MockSignJWT,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("fcm", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.FCM_PROJECT_ID = "test-project";
    process.env.FCM_SERVICE_ACCOUNT_EMAIL = "sa@test.iam.gserviceaccount.com";
    process.env.FCM_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----";
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("isFcmConfigured returns true when all env vars are set", async () => {
    const { isFcmConfigured } = await import("./fcm");
    expect(isFcmConfigured()).toBe(true);
  });

  it("isFcmConfigured returns false when env vars are missing", async () => {
    delete process.env.FCM_PROJECT_ID;
    delete process.env.FCM_SERVICE_ACCOUNT_EMAIL;
    delete process.env.FCM_PRIVATE_KEY;
    const { isFcmConfigured } = await import("./fcm");
    expect(isFcmConfigured()).toBe(false);
  });

  it("sendFcmNotification returns true on successful delivery", async () => {
    // Mock token exchange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "mock-access-token", expires_in: 3600 }),
    });

    // Mock FCM send
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ name: "projects/test-project/messages/123" }),
    });

    const { sendFcmNotification, _resetTokenCache } = await import("./fcm");
    _resetTokenCache();

    const result = await sendFcmNotification("device-token-123", {
      title: "Test",
      body: "Hello",
      url: "/app/groups/1",
      tag: "test-tag",
    });

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify FCM send call
    const fcmCall = mockFetch.mock.calls[1];
    expect(fcmCall[0]).toBe("https://fcm.googleapis.com/v1/projects/test-project/messages:send");
    const body = JSON.parse(fcmCall[1].body);
    expect(body.message.token).toBe("device-token-123");
    expect(body.message.notification.title).toBe("Test");
    expect(body.message.notification.body).toBe("Hello");
    expect(body.message.data.url).toBe("/app/groups/1");
  });

  it("sendFcmNotification returns false on 404 (unregistered token)", async () => {
    // Token exchange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "mock-access-token", expires_in: 3600 }),
    });

    // FCM send — 404
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { details: [{ errorCode: "UNREGISTERED" }] } }),
    });

    const { sendFcmNotification, _resetTokenCache } = await import("./fcm");
    _resetTokenCache();

    const result = await sendFcmNotification("stale-token", {
      title: "Test",
      body: "Gone",
    });

    expect(result).toBe(false);
  });

  it("sendFcmNotification returns false on UNREGISTERED error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "mock-access-token", expires_in: 3600 }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { details: [{ errorCode: "UNREGISTERED" }] } }),
    });

    const { sendFcmNotification, _resetTokenCache } = await import("./fcm");
    _resetTokenCache();

    const result = await sendFcmNotification("unregistered-token", {
      title: "Test",
      body: "Unregistered",
    });

    expect(result).toBe(false);
  });

  it("sendFcmNotification throws on unexpected errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "mock-access-token", expires_in: 3600 }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const { sendFcmNotification, _resetTokenCache } = await import("./fcm");
    _resetTokenCache();

    await expect(
      sendFcmNotification("token", { title: "Test", body: "Fail" }),
    ).rejects.toThrow("FCM send failed (500)");
  });

  it("throws when FCM_PROJECT_ID is missing", async () => {
    delete process.env.FCM_PROJECT_ID;

    const { sendFcmNotification } = await import("./fcm");

    await expect(
      sendFcmNotification("token", { title: "Test", body: "No project" }),
    ).rejects.toThrow("FCM_PROJECT_ID not configured");
  });

  it("caches the access token across calls", async () => {
    // First call: token exchange + send
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "cached-token", expires_in: 3600 }),
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const { sendFcmNotification, _resetTokenCache } = await import("./fcm");
    _resetTokenCache();

    await sendFcmNotification("token-1", { title: "T1", body: "B1" });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second call: only send (no token exchange)
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await sendFcmNotification("token-2", { title: "T2", body: "B2" });
    expect(mockFetch).toHaveBeenCalledTimes(3); // Not 4 — token was cached
  });
});
