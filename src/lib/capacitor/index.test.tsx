import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIsNative = vi.fn(() => true);
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mockIsNative() },
}));

vi.mock("@capacitor/splash-screen", () => ({
  SplashScreen: { hide: vi.fn().mockResolvedValue(undefined) },
}));

const mockGetLaunchUrl = vi.fn<() => Promise<{ url: string } | null>>();
const appListeners = vi.hoisted(
  () => ({}) as Record<string, (event: { url: string }) => void>,
);
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn((event: string, handler: (event: { url: string }) => void) => {
      appListeners[event] = handler;
      return Promise.resolve({ remove: vi.fn() });
    }),
    exitApp: vi.fn(),
    getLaunchUrl: () => mockGetLaunchUrl(),
  },
}));

vi.mock("./status-bar", () => ({
  configureStatusBar: vi.fn().mockResolvedValue(undefined),
}));

import { initCapacitor } from "./index";

function flushMacrotasks(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

const INVITE = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";
const CLAIM = "gst1_" + "a".repeat(43);
const ROOM_ID = "00000000-0000-4000-8000-000000000001";
const ROOM_TOKEN = `armj1_${"A".repeat(43)}`;

describe("cold-start deep links", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockIsNative.mockReturnValue(true);
    mockGetLaunchUrl.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lands a force-stopped launch on the invite page exactly once", async () => {
    mockGetLaunchUrl.mockResolvedValue({ url: `https://www.dividimos.ai/join/${INVITE}` });
    const replace = vi.fn();

    await initCapacitor(replace);
    expect(replace).toHaveBeenCalledWith(`/join/${INVITE}`);

    // A reload re-runs init; the stored digest keeps it from firing again.
    await initCapacitor(replace);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("still navigates a cold claim exactly once", async () => {
    mockGetLaunchUrl.mockResolvedValue({ url: `https://www.dividimos.ai/claim#${CLAIM}` });
    const replace = vi.fn();

    await initCapacitor(replace);
    await initCapacitor(replace);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(`/claim#${CLAIM}`);
  });

  it("navigates a cold room fragment exactly once", async () => {
    mockGetLaunchUrl.mockResolvedValue({
      url: `https://www.dividimos.ai/room/${ROOM_ID}#${ROOM_TOKEN}`,
    });
    const replace = vi.fn();

    await initCapacitor(replace);
    await initCapacitor(replace);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(`/room/${ROOM_ID}#${ROOM_TOKEN}`);
  });

  it("navigates a cold custom-scheme launch to the route that exists", async () => {
    mockGetLaunchUrl.mockResolvedValue({ url: "dividimos://app/groups/g1" });
    const replace = vi.fn();

    await initCapacitor(replace);

    expect(replace).toHaveBeenCalledWith("/app/groups/g1");
  });

  it("ignores a launch URL that resolves to nothing", async () => {
    mockGetLaunchUrl.mockResolvedValue({ url: "https://evil.example.com/join/x" });
    const replace = vi.fn();

    await initCapacitor(replace);

    expect(replace).not.toHaveBeenCalled();
  });

  it("navigates a warm universal link through appUrlOpen", async () => {
    mockGetLaunchUrl.mockResolvedValue(null);
    const replace = vi.fn();
    await initCapacitor(replace);

    appListeners["appUrlOpen"]!({ url: `https://www.dividimos.ai/claim#${CLAIM}` });
    await flushMacrotasks();

    expect(replace).toHaveBeenCalledWith(`/claim#${CLAIM}`);
  });

  it("ignores a warm foreign-host link through appUrlOpen", async () => {
    mockGetLaunchUrl.mockResolvedValue(null);
    const replace = vi.fn();
    await initCapacitor(replace);

    appListeners["appUrlOpen"]!({ url: "https://evil.example.com/join/x" });
    await flushMacrotasks();

    expect(replace).not.toHaveBeenCalled();
  });

  it("treats a cold-start URL that iOS delivers twice as one launch", async () => {
    // iOS cold start can deliver the same URL through both getLaunchUrl and
    // appUrlOpen; both deliveries must land on the identical target and a
    // later re-init must not re-consume the invite.
    const inviteUrl = `https://www.dividimos.ai/join/${INVITE}`;
    mockGetLaunchUrl.mockResolvedValue({ url: inviteUrl });
    const replace = vi.fn();

    await initCapacitor(replace);
    expect(replace).toHaveBeenCalledWith(`/join/${INVITE}`);

    appListeners["appUrlOpen"]!({ url: inviteUrl });
    await flushMacrotasks();
    expect(replace).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenNthCalledWith(2, `/join/${INVITE}`);

    await initCapacitor(replace);
    expect(replace).toHaveBeenCalledTimes(2);
  });
});
