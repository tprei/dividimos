import { AuthSessionMissingError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
  resolveAuthProfile: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/auth", () => ({ resolveAuthProfile: mocks.resolveAuthProfile }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import ContinuePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
  mocks.resolveAuthProfile.mockResolvedValue({
    kind: "ok",
    me: { id: "user-a", onboarded: false },
  });
});

describe("auth continuation", () => {
  it("sends incomplete profiles to onboarding with the safe destination", async () => {
    await expect(
      ContinuePage({ searchParams: Promise.resolve({ next: "/invite?token=abc" }) }),
    ).rejects.toThrow("REDIRECT:/auth/onboard?next=%2Finvite%3Ftoken%3Dabc");
  });
  it("sends an unauthenticated session to auth", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });

    await expect(
      ContinuePage({ searchParams: Promise.resolve({ next: "/groups" }) }),
    ).rejects.toThrow("REDIRECT:/auth?next=%2Fgroups");
  });

  it("sends complete profiles to the requested destination", async () => {
    mocks.resolveAuthProfile.mockResolvedValue({
      kind: "ok",
      me: { id: "user-a", onboarded: true },
    });

    await expect(
      ContinuePage({ searchParams: Promise.resolve({ next: "/groups" }) }),
    ).rejects.toThrow("REDIRECT:/groups");
  });
  it("falls back safely when next is repeated instead of passing an array to redirects", async () => {
    mocks.resolveAuthProfile.mockResolvedValue({
      kind: "ok",
      me: { id: "user-a", onboarded: true },
    });

    await expect(
      ContinuePage({ searchParams: Promise.resolve({ next: ["/groups", "/admin"] }) }),
    ).rejects.toThrow("REDIRECT:/app");
  });

  it("renders retryable copy when the profile read fails", async () => {
    mocks.resolveAuthProfile.mockResolvedValue({ kind: "read_failed" });

    const result = await ContinuePage({ searchParams: Promise.resolve({ next: "/groups" }) });
    expect(result).toMatchObject({ props: { children: expect.anything() } });
  });
});
