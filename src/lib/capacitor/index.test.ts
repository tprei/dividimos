import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIsNative = vi.fn(() => true);
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mockIsNative() },
}));

vi.mock("@capacitor/splash-screen", () => ({
  SplashScreen: { hide: vi.fn().mockResolvedValue(undefined) },
}));

const mockGetLaunchUrl = vi.fn<() => Promise<{ url: string } | null>>();
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    exitApp: vi.fn(),
    getLaunchUrl: () => mockGetLaunchUrl(),
  },
}));

vi.mock("./status-bar", () => ({
  configureStatusBar: vi.fn().mockResolvedValue(undefined),
}));

import { initCapacitor } from "./index";

const INVITE = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";
const CLAIM = "gst1_" + "a".repeat(43);

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
});
