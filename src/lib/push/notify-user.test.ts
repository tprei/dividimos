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

    expect(result).toEqual({ sent: 0, cleaned: 0 });
  });

  it("sends to all valid web subscriptions", async () => {
    const subJson = JSON.stringify({ endpoint: "https://fcm.example.com/abc" });
    mockEq.mockResolvedValue({
      data: [
        { id: "sub-1", subscription: "encrypted-1", channel: "web" },
        { id: "sub-2", subscription: "encrypted-2", channel: "web" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue(subJson);
    vi.mocked(sendPushNotification).mockResolvedValue(true);

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 2, cleaned: 0 });
    expect(sendPushNotification).toHaveBeenCalledTimes(2);
    expect(sendFcmNotification).not.toHaveBeenCalled();
  });

  it("sends to FCM subscriptions via sendFcmNotification", async () => {
    mockEq.mockResolvedValue({
      data: [
        { id: "sub-1", subscription: "encrypted-fcm-token", channel: "fcm" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue("device-token-123");
    vi.mocked(sendFcmNotification).mockResolvedValue(true);

    const payload = { title: "Hi", body: "Test" };
    const result = await notifyUser("user-1", payload);

    expect(result).toEqual({ sent: 1, cleaned: 0 });
    expect(sendFcmNotification).toHaveBeenCalledWith("device-token-123", payload);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("routes web and FCM subscriptions to correct senders", async () => {
    const webSubJson = JSON.stringify({ endpoint: "https://push.example.com/abc" });

    mockEq.mockResolvedValue({
      data: [
        { id: "web-1", subscription: "encrypted-web", channel: "web" },
        { id: "fcm-1", subscription: "encrypted-fcm", channel: "fcm" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockImplementation((encrypted: string) => {
      if (encrypted === "encrypted-web") return webSubJson;
      if (encrypted === "encrypted-fcm") return "device-token-456";
      throw new Error("unknown");
    });

    vi.mocked(sendPushNotification).mockResolvedValue(true);
    vi.mocked(sendFcmNotification).mockResolvedValue(true);

    const payload = { title: "Hi", body: "Test" };
    const result = await notifyUser("user-1", payload);

    expect(result).toEqual({ sent: 2, cleaned: 0 });
    expect(sendPushNotification).toHaveBeenCalledWith(webSubJson, payload);
    expect(sendFcmNotification).toHaveBeenCalledWith("device-token-456", payload);
  });

  it("skips FCM subscriptions when FCM is not configured", async () => {
    vi.mocked(isFcmConfigured).mockReturnValue(false);

    mockEq.mockResolvedValue({
      data: [
        { id: "fcm-1", subscription: "encrypted-fcm", channel: "fcm" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue("device-token");

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 0, cleaned: 0 });
    expect(sendFcmNotification).not.toHaveBeenCalled();
  });

  it("cleans up stale subscriptions (410/404)", async () => {
    const subJson = JSON.stringify({ endpoint: "https://fcm.example.com/abc" });
    mockEq.mockResolvedValue({
      data: [
        { id: "sub-1", subscription: "encrypted-1", channel: "web" },
        { id: "sub-2", subscription: "encrypted-2", channel: "web" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue(subJson);
    vi.mocked(sendPushNotification)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false); // stale

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 1, cleaned: 1 });
    expect(mockDelete).toHaveBeenCalled();
    expect(mockIn).toHaveBeenCalledWith("id", ["sub-2"]);
  });

  it("cleans up stale FCM subscriptions", async () => {
    mockEq.mockResolvedValue({
      data: [
        { id: "fcm-1", subscription: "encrypted-fcm", channel: "fcm" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue("stale-device-token");
    vi.mocked(sendFcmNotification).mockResolvedValue(false);

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 0, cleaned: 1 });
    expect(mockIn).toHaveBeenCalledWith("id", ["fcm-1"]);
  });

  it("cleans up subscriptions that fail to decrypt", async () => {
    mockEq.mockResolvedValue({
      data: [{ id: "sub-1", subscription: "corrupted", channel: "web" }],
      error: null,
    });

    vi.mocked(decryptPixKey).mockImplementation(() => {
      throw new Error("decrypt failed");
    });

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 0, cleaned: 1 });
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("returns zeros on database error", async () => {
    mockEq.mockResolvedValue({ data: null, error: { message: "db error" } });

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 0, cleaned: 0 });
  });

  it("defaults to web channel when channel is null", async () => {
    const subJson = JSON.stringify({ endpoint: "https://push.example.com/abc" });
    mockEq.mockResolvedValue({
      data: [
        { id: "sub-1", subscription: "encrypted-1", channel: null },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue(subJson);
    vi.mocked(sendPushNotification).mockResolvedValue(true);

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 1, cleaned: 0 });
    expect(sendPushNotification).toHaveBeenCalledWith(subJson, { title: "Hi", body: "Test" });
    expect(sendFcmNotification).not.toHaveBeenCalled();
  });
});
