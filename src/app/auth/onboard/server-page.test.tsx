import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/types/ledger";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
  resolveAuthProfile: vi.fn(),
  completeOnboarding: vi.fn().mockResolvedValue(undefined),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/auth", () => ({ resolveAuthProfile: mocks.resolveAuthProfile }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./actions", () => ({ completeOnboarding: mocks.completeOnboarding }));

import OnboardPage from "./page";

const profile = (overrides: Partial<Me> = {}): Me => ({
  id: "user-a",
  handle: "ana_costa",
  name: "Ana Costa",
  avatarUrl: null,
  email: "ana@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: false,
  notificationPreferences: {},
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
  });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
  mocks.resolveAuthProfile.mockResolvedValue({ kind: "ok", me: profile() });
});


describe("server onboarding boundary", () => {
  it("passes verified identity and destination through the server action closure", async () => {
    const result = await OnboardPage({ searchParams: Promise.resolve({ next: "/groups" }) });
    const formData = new FormData();

    await result.props.action(formData);

    expect(mocks.completeOnboarding).toHaveBeenCalledWith("user-a", "/groups", formData);
  });
  it("does not render the form when the profile is already onboarded", async () => {
    mocks.resolveAuthProfile.mockResolvedValue({ kind: "ok", me: profile({ onboarded: true }) });

    await expect(
      OnboardPage({ searchParams: Promise.resolve({ next: "/groups" }) }),
    ).rejects.toThrow("REDIRECT:/groups");
  });

  it("sends a missing session to auth with the full safe destination", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(
      OnboardPage({ searchParams: Promise.resolve({ next: "/invite?token=abc" }) }),
    ).rejects.toThrow("REDIRECT:/auth?next=%2Finvite%3Ftoken%3Dabc");

    expect(mocks.resolveAuthProfile).not.toHaveBeenCalled();
  });

  it("renders retryable copy when profile resolution fails", async () => {
    mocks.resolveAuthProfile.mockResolvedValue({ kind: "read_failed" });

    const result = await OnboardPage({ searchParams: Promise.resolve({ next: "/groups" }) });
    expect(result).toMatchObject({ props: { children: expect.anything() } });
  });
});
