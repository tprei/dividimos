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

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPixKey } from "@/lib/crypto";
import { sendPushNotification } from "./web-push";
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
  });

  it("returns zeros when user has no subscriptions", async () => {
    mockEq.mockResolvedValue({ data: [], error: null });

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 0, cleaned: 0 });
  });

  it("sends to all valid subscriptions", async () => {
    const subJson = JSON.stringify({ endpoint: "https://fcm.example.com/abc" });
    mockEq.mockResolvedValue({
      data: [
        { id: "sub-1", subscription: "encrypted-1" },
        { id: "sub-2", subscription: "encrypted-2" },
      ],
      error: null,
    });

    vi.mocked(decryptPixKey).mockReturnValue(subJson);
    vi.mocked(sendPushNotification).mockResolvedValue(true);

    const result = await notifyUser("user-1", { title: "Hi", body: "Test" });

    expect(result).toEqual({ sent: 2, cleaned: 0 });
    expect(sendPushNotification).toHaveBeenCalledTimes(2);
  });

  it("cleans up stale subscriptions (410/404)", async () => {
    const subJson = JSON.stringify({ endpoint: "https://fcm.example.com/abc" });
    mockEq.mockResolvedValue({
      data: [
        { id: "sub-1", subscription: "encrypted-1" },
        { id: "sub-2", subscription: "encrypted-2" },
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

  it("cleans up subscriptions that fail to decrypt", async () => {
    mockEq.mockResolvedValue({
      data: [{ id: "sub-1", subscription: "corrupted" }],
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
});
