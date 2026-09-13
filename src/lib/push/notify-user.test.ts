import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  decryptPixKey: vi.fn(),
}));

vi.mock("./web-push", () => ({
  sendPushNotification: vi.fn(),
}));

vi.mock("./fcm", () => ({
  sendFcmNotification: vi.fn(),
  isFcmConfigured: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPixKey } from "@/lib/crypto";
import { sendPushNotification } from "./web-push";
import { sendFcmNotification, isFcmConfigured } from "./fcm";
import { notifyUser } from "./notify-user";

describe("notifyUser", () => {
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  const mockEq = vi.fn();
  const mockDelete = vi.fn();
  const mockIn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Chain: admin.from("push_subscriptions").select(...).eq(...)
    mockIn.mockResolvedValue({ error: null });
    mockDelete.mockReturnValue({ in: mockIn });
    mockEq.mockResolvedValue({ data: [], error: null });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({
      select: mockSelect,
      delete: mockDelete,
    });
    vi.mocked(createAdminClient).mockReturnValue({ from: mockFrom } as never);
    vi.mocked(isFcmConfigured).mockReturnValue(true);
  });

  it("returns zeros when user has no subscriptions", async () => {
    mockEq.mockResolvedValue({ data: [], error: null });

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 0, cleaned: 0, failed: 0 });
  });

  it("sends to all valid web subscriptions", async () => {
    const subJson = JSON.stringify({ endpoint: "https://fcm.example.com/abc" });
    mockEq.mockResolvedValue({
      data: [
        { id: "sub-1", subscription_encrypted: "encrypted-1", channel: "web" },
        { id: "sub-2", subscription_encrypted: "encrypted-2", channel: "web" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue(subJson);
    vi.mocked(sendPushNotification).mockResolvedValue({ status: "accepted" });

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 2, cleaned: 0, failed: 0 });
    expect(sendPushNotification).toHaveBeenCalledTimes(2);
    expect(sendFcmNotification).not.toHaveBeenCalled();
  });

  it("sends to FCM subscriptions via sendFcmNotification", async () => {
    mockEq.mockResolvedValue({
      data: [
        { id: "sub-1", subscription_encrypted: "encrypted-fcm-token", channel: "fcm" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue("device-token-123");
    vi.mocked(sendFcmNotification).mockResolvedValue(true);

    const payload = { title: "Hi", body: "Test" };
    const result = await notifyUser("user-1", payload);

    expect(result).toEqual({ sent: 1, cleaned: 0, failed: 0 });
    expect(sendFcmNotification).toHaveBeenCalledWith("device-token-123", payload);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("routes web and FCM subscriptions to correct senders", async () => {
    const webSubJson = JSON.stringify({ endpoint: "https://push.example.com/abc" });

    mockEq.mockResolvedValue({
      data: [
        { id: "web-1", subscription_encrypted: "encrypted-web", channel: "web" },
        { id: "fcm-1", subscription_encrypted: "encrypted-fcm", channel: "fcm" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockImplementation((encrypted: string) => {
      if (encrypted === "encrypted-web") return webSubJson;
      if (encrypted === "encrypted-fcm") return "device-token-456";
      throw new Error("unknown");
    });

    vi.mocked(sendPushNotification).mockResolvedValue({ status: "accepted" });
    vi.mocked(sendFcmNotification).mockResolvedValue(true);

    const payload = { title: "Hi", body: "Test" };
    const result = await notifyUser("user-1", payload);

    expect(result).toEqual({ sent: 2, cleaned: 0, failed: 0 });
    expect(sendPushNotification).toHaveBeenCalledWith(webSubJson, payload);
    expect(sendFcmNotification).toHaveBeenCalledWith("device-token-456", payload);
  });

  it("reports an unconfigured FCM provider as a failure, not a silent success", async () => {
    vi.mocked(isFcmConfigured).mockReturnValue(false);

    mockEq.mockResolvedValue({
      data: [
        { id: "fcm-1", subscription_encrypted: "encrypted-fcm", channel: "fcm" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue("device-token");

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 0, cleaned: 0, failed: 1 });
    expect(sendFcmNotification).not.toHaveBeenCalled();
  });

  it("cleans up stale subscriptions (410/404)", async () => {
    const subJson = JSON.stringify({ endpoint: "https://fcm.example.com/abc" });
    mockEq.mockResolvedValue({
      data: [
        { id: "sub-1", subscription_encrypted: "encrypted-1", channel: "web" },
        { id: "sub-2", subscription_encrypted: "encrypted-2", channel: "web" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue(subJson);
    vi.mocked(sendPushNotification)
      .mockResolvedValueOnce({ status: "accepted" })
      .mockResolvedValueOnce({ status: "stale" });

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 1, cleaned: 1, failed: 0 });
    expect(mockDelete).toHaveBeenCalled();
    expect(mockIn).toHaveBeenCalledWith("id", ["sub-2"]);
  });
  it("retains web subscriptions after transient failures", async () => {
    mockEq.mockResolvedValue({
      data: [{ id: "sub-1", subscription_encrypted: "encrypted-1", channel: "web" }],
      error: null,
    });
    vi.mocked(decryptPixKey).mockReturnValue(JSON.stringify({ endpoint: "https://fcm.example.com/abc" }));
    vi.mocked(sendPushNotification).mockResolvedValue({ status: "failed" });

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 0, cleaned: 0, failed: 1 });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("cleans up stale FCM subscriptions", async () => {
    mockEq.mockResolvedValue({
      data: [
        { id: "fcm-1", subscription_encrypted: "encrypted-fcm", channel: "fcm" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue("stale-device-token");
    vi.mocked(sendFcmNotification).mockResolvedValue(false);

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 0, cleaned: 1, failed: 0 });
    expect(mockIn).toHaveBeenCalledWith("id", ["fcm-1"]);
  });

  it("cleans up subscriptions that fail to decrypt", async () => {
    mockEq.mockResolvedValue({
      data: [{ id: "sub-1", subscription_encrypted: "corrupted", channel: "web" }],
      error: null,
    });

    vi.mocked(decryptPixKey).mockImplementation(() => {
      throw new Error("decrypt failed");
    });

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 0, cleaned: 1, failed: 0 });
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("returns zeros on database error", async () => {
    mockEq.mockResolvedValue({ data: null, error: { message: "db error" } });

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 0, cleaned: 0, failed: 1 });
  });

  it("defaults to web channel when channel is null", async () => {
    const subJson = JSON.stringify({ endpoint: "https://push.example.com/abc" });
    mockEq.mockResolvedValue({
      data: [
        { id: "sub-1", subscription_encrypted: "encrypted-1", channel: null },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue(subJson);
    vi.mocked(sendPushNotification).mockResolvedValue({ status: "accepted" });

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 1, cleaned: 0, failed: 0 });
    expect(sendPushNotification).toHaveBeenCalledWith(subJson, { title: "Hi", body: "Test" });
    expect(sendFcmNotification).not.toHaveBeenCalled();
  });

  it("settles every device: valid ones send, stale ones are cleaned, failures are reported", async () => {
    mockEq.mockResolvedValue({
      data: [
        { id: "ok", subscription_encrypted: "e1", channel: "web" },
        { id: "gone", subscription_encrypted: "e2", channel: "web" },
        { id: "flaky", subscription_encrypted: "e3", channel: "web" },
      ],
      error: null,
    });
    vi.mocked(decryptPixKey).mockImplementation((v: string) => v);
    vi.mocked(sendPushNotification).mockImplementation(async (sub: string) => {
      if (sub === "e1") return { status: "accepted" as const };
      if (sub === "e2") return { status: "stale" as const };
      // A provider that throws must not take its siblings down.
      throw new Error("provider exploded");
    });

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 1, cleaned: 1, failed: 1 });
    // Cleanup still runs even though a sibling rejected.
    expect(mockIn).toHaveBeenCalledWith("id", ["gone"]);
  });
});
