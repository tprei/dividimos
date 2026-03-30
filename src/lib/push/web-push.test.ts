import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock web-push before importing the module
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

describe("web-push", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BFakePublicKeyForTesting123456789012345678901234567890123456789012345";
    process.env.VAPID_PRIVATE_KEY = "fakePrivateKeyForTesting1234567890123456";
    process.env.VAPID_SUBJECT = "mailto:test@pagajaja.app";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("sendPushNotification returns true on successful delivery", async () => {
    const webpush = await import("web-push");
    vi.mocked(webpush.default.sendNotification).mockResolvedValue({} as never);

    const { sendPushNotification } = await import("./web-push");

    const subscription = JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "key1", auth: "key2" },
    });

    const result = await sendPushNotification(subscription, {
      title: "Test",
      body: "Hello",
    });

    expect(result).toBe(true);
    expect(webpush.default.sendNotification).toHaveBeenCalled();
  });

  it("sendPushNotification returns false on 410 (gone)", async () => {
    const webpush = await import("web-push");
    vi.mocked(webpush.default.sendNotification).mockRejectedValue({ statusCode: 410 });

    const { sendPushNotification } = await import("./web-push");

    const subscription = JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "key1", auth: "key2" },
    });

    const result = await sendPushNotification(subscription, {
      title: "Test",
      body: "Gone",
    });

    expect(result).toBe(false);
  });

  it("sendPushNotification returns false on 404 (not found)", async () => {
    const webpush = await import("web-push");
    vi.mocked(webpush.default.sendNotification).mockRejectedValue({ statusCode: 404 });

    const { sendPushNotification } = await import("./web-push");

    const subscription = JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "key1", auth: "key2" },
    });

    const result = await sendPushNotification(subscription, {
      title: "Test",
      body: "Not found",
    });

    expect(result).toBe(false);
  });

  it("sendPushNotification throws on unexpected errors", async () => {
    const webpush = await import("web-push");
    vi.mocked(webpush.default.sendNotification).mockRejectedValue(
      new Error("network failure"),
    );

    const { sendPushNotification } = await import("./web-push");

    const subscription = JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "key1", auth: "key2" },
    });

    await expect(
      sendPushNotification(subscription, { title: "Test", body: "Fail" }),
    ).rejects.toThrow("network failure");
  });

  it("isWebPushConfigured returns true when keys are set", async () => {
    const { isWebPushConfigured } = await import("./web-push");
    expect(isWebPushConfigured()).toBe(true);
  });

  it("isWebPushConfigured returns false when keys are missing", async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const { isWebPushConfigured } = await import("./web-push");
    expect(isWebPushConfigured()).toBe(false);
  });
});
