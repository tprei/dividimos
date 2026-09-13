import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import https from "node:https";

type TestSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
type TestValidation =
  | { ok: true; value: TestSubscription }
  | { ok: false; reason: "invalid" | "resolution_failed" };

const mockValidateWebSubscription = vi.hoisted(() =>
  vi.fn<(value: unknown) => Promise<TestValidation>>(async (value) => ({
    ok: true,
    value: value as TestSubscription,
  })),
);
const mockCreateAgent = vi.hoisted(() =>
  vi.fn(() => new https.Agent({ keepAlive: false })),
);
const webPushMock = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: webPushMock,
}));

vi.mock("./validate-endpoint", () => ({
  createRebindingSafeAgent: mockCreateAgent,
  validateWebSubscription: mockValidateWebSubscription,
}));

describe("web-push", () => {
  const originalEnv = { ...process.env };
  const subscription = JSON.stringify({
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: {
      p256dh:
        "BCNXu22ndNATY-RZtaeIvbY2I92MODTxto2tmvWhhpTM-FgTfREXkh2l8LyhFkoPOtCnMUE3ultxDvWJtINvgF8",
      auth: "AQEBAQEBAQEBAQEBAQEBAQ",
    },
  });

  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BFakePublicKeyForTesting123456789012345678901234567890123456789012345";
    process.env.VAPID_PRIVATE_KEY = "fakePrivateKeyForTesting1234567890123456";
    process.env.VAPID_SUBJECT = "mailto:test@dividimos.ai";
    mockValidateWebSubscription.mockReset();
    mockValidateWebSubscription.mockResolvedValue({
      ok: true,
      value: JSON.parse(subscription),
    });
    mockCreateAgent.mockClear();
    webPushMock.setVapidDetails.mockClear();
    webPushMock.sendNotification.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns accepted when the provider accepts the request", async () => {
    const webpush = await import("web-push");
    vi.mocked(webpush.default.sendNotification).mockResolvedValue({} as never);

    const { sendPushNotification } = await import("./web-push");
    const result = await sendPushNotification(subscription, {
      title: "Test",
      body: "Hello",
    });

    expect(result).toEqual({ status: "accepted" });
    expect(webpush.default.sendNotification).toHaveBeenCalledWith(
      JSON.parse(subscription),
      JSON.stringify({ title: "Test", body: "Hello" }),
      expect.objectContaining({
        agent: expect.any(https.Agent),
        timeout: 10_000,
      }),
    );
    expect(mockCreateAgent).toHaveBeenCalledWith("fcm.googleapis.com");
  });

  it.each([404, 410])("returns stale on definitive status %s", async (statusCode) => {
    const webpush = await import("web-push");
    vi.mocked(webpush.default.sendNotification).mockRejectedValue({ statusCode });
    const { sendPushNotification } = await import("./web-push");

    await expect(
      sendPushNotification(subscription, { title: "Test", body: "Gone" }),
    ).resolves.toEqual({ status: "stale" });
  });

  it("returns failed for transient provider errors", async () => {
    const webpush = await import("web-push");
    vi.mocked(webpush.default.sendNotification).mockRejectedValue(
      new Error("network failure"),
    );
    const { sendPushNotification } = await import("./web-push");

    await expect(
      sendPushNotification(subscription, { title: "Test", body: "Fail" }),
    ).resolves.toEqual({ status: "failed" });
  });

  it("returns failed for invalid stored subscriptions", async () => {
    mockValidateWebSubscription.mockResolvedValue({
      ok: false,
      reason: "invalid",
    });
    const webpush = await import("web-push");
    const { sendPushNotification } = await import("./web-push");

    await expect(
      sendPushNotification("not-json", { title: "Test", body: "Invalid" }),
    ).resolves.toEqual({ status: "failed" });
    expect(webpush.default.sendNotification).not.toHaveBeenCalled();
  });

  it("returns failed when stored endpoint DNS resolution fails", async () => {
    mockValidateWebSubscription.mockResolvedValue({
      ok: false,
      reason: "resolution_failed",
    });
    const { sendPushNotification } = await import("./web-push");

    await expect(
      sendPushNotification(subscription, { title: "Test", body: "DNS" }),
    ).resolves.toEqual({ status: "failed" });
  });

  it("isWebPushConfigured reflects VAPID configuration", async () => {
    const { isWebPushConfigured } = await import("./web-push");
    expect(isWebPushConfigured()).toBe(true);

    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    vi.resetModules();
    const missing = await import("./web-push");
    expect(missing.isWebPushConfigured()).toBe(false);
  });
});
