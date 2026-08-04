import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { User } from "@/types";
import type { OnboardingDraftSeed } from "./onboard-form";
import type { CompleteOnboardingResult } from "./actions";

// --- Types for the seams under test -------------------------------------

type CompleteOnboardingFn = (
  expectedUserId: string,
  redirectTo: string,
  formData: FormData,
) => Promise<CompleteOnboardingResult>;

type FormAction = (formData: FormData) => Promise<CompleteOnboardingResult>;

type CapturedForm = {
  seed: OnboardingDraftSeed | null;
  action: FormAction | null;
};

type ActionsModule = { completeOnboarding: CompleteOnboardingFn };

// --- Mocks --------------------------------------------------------------

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    // Mirrors Next's never-returning redirect: halt at the call site.
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const formCapture = vi.hoisted((): CapturedForm => ({
  seed: null,
  action: null,
}));

vi.mock("./onboard-form", () => ({
  OnboardForm: ({
    seed,
    action,
  }: {
    seed: OnboardingDraftSeed;
    action: FormAction;
  }) => {
    formCapture.seed = seed;
    formCapture.action = action;
    return <div data-testid="onboard-form-mock" />;
  },
}));

const { completeOnboardingMock } = vi.hoisted(() => ({
  completeOnboardingMock: vi.fn<CompleteOnboardingFn>(),
}));

vi.mock("./actions", () => ({
  completeOnboarding: completeOnboardingMock,
}));

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const getAuthUserMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getAuthUser: (...args: unknown[]) => getAuthUserMock(...args),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    rpc: vi.fn(),
  }),
}));

vi.mock("@/lib/crypto", () => ({
  encryptPixKey: vi.fn((v: string) => `enc(${v})`),
}));

vi.mock("@/lib/pix", () => ({
  validatePixKey: vi.fn(() => true),
  maskPixKey: vi.fn((v: string) => `hint(${v})`),
}));

import OnboardPage from "./page";

// --- Fixtures ------------------------------------------------------------

const USER_A: User = {
  id: "user-a",
  email: "ana@test.com",
  handle: "ana",
  name: "Ana Costa",
  pixKeyType: "email",
  pixKeyHint: "",
  onboarded: false,
  createdAt: "2026-01-01T00:00:00Z",
};

function authOnlyClient(user: { id: string } | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

type EqCall = { column: string; value: unknown };

function makeUsersUpdateMock(result: { data: unknown; error: unknown }) {
  const eqCalls: EqCall[] = [];
  let updatePayload: unknown = null;
  const eqResult = {
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push({ column, value });
      return eqResult;
    }),
    select: vi.fn(() => Promise.resolve(result)),
  };
  const from = vi.fn(() => ({
    update: vi.fn((payload: unknown) => {
      updatePayload = payload;
      return eqResult;
    }),
  }));
  return { from, eqCalls, getPayload: () => updatePayload };
}

class RecordingFormData extends FormData {
  readonly readKeys: string[] = [];
  get(name: string): FormDataEntryValue | null {
    this.readKeys.push(name);
    return super.get(name);
  }
}

function hostileFormData() {
  const fd = new RecordingFormData();
  fd.set("name", "Ana Costa");
  fd.set("handle", "ana");
  fd.set("pixKeyType", "email");
  fd.set("pixKey", "ana@test.com");
  fd.set("sourceUserId", "user-b");
  fd.set("expectedUserId", "user-b");
  fd.set("userId", "user-b");
  fd.set("next", "//evil");
  return fd;
}

beforeEach(() => {
  redirectMock.mockClear();
  formCapture.seed = null;
  formCapture.action = null;
  createClientMock.mockReset();
  getAuthUserMock.mockReset();
  completeOnboardingMock.mockReset();
});

async function renderPage(next?: string | string[]) {
  const searchParams = Promise.resolve(next === undefined ? {} : { next });
  const jsx = await OnboardPage({ searchParams });
  return render(jsx);
}

// --- Cases ---------------------------------------------------------------

describe("OnboardPage Server Component boundary", () => {
  it("passes the server-captured userId and sanitized redirect to the helper, ignoring hostile FormData", async () => {
    createClientMock.mockResolvedValue(authOnlyClient({ id: "user-a" }));
    getAuthUserMock.mockResolvedValue(USER_A);

    await renderPage("/dashboard");

    expect(formCapture.action).not.toBeNull();
    completeOnboardingMock.mockImplementationOnce(async () => ({
      kind: "completed",
      redirectTo: "/dashboard",
    }));

    const result = await formCapture.action!(hostileFormData());

    expect(result).toEqual({ kind: "completed", redirectTo: "/dashboard" });
    expect(completeOnboardingMock).toHaveBeenCalledTimes(1);
    const [expectedUserId, redirectTo] = completeOnboardingMock.mock.calls[0];
    // The closure captured the verified A, never the FormData's B.
    expect(expectedUserId).toBe("user-a");
    expect(redirectTo).toBe("/dashboard");
  });

  it("reads only the four allowed keys and fences the write by id=A AND onboarded=false (real helper)", async () => {
    const real = await vi.importActual<ActionsModule>("./actions");
    completeOnboardingMock.mockImplementation(real.completeOnboarding);

    const users = makeUsersUpdateMock({ data: [{ id: "user-a" }], error: null });
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: "user-a" } }, error: null }),
      },
      from: users.from,
    });
    getAuthUserMock.mockResolvedValue(USER_A);

    await renderPage("/app");

    const fd = hostileFormData();
    const result = await formCapture.action!(fd);

    // Only the four sanctioned keys were ever read.
    expect(fd.readKeys).toEqual(["name", "handle", "pixKeyType", "pixKey"]);
    // The compare-and-set fence targets A and onboarded=false — never B.
    expect(users.eqCalls).toEqual([
      { column: "id", value: "user-a" },
      { column: "onboarded", value: false },
    ]);
    expect(result.kind).toBe("completed");
    expect(result).toMatchObject({ redirectTo: "/app" });
  });

  it("collapses an unsafe `next` to /app", async () => {
    createClientMock.mockResolvedValue(authOnlyClient({ id: "user-a" }));
    getAuthUserMock.mockResolvedValue(USER_A);

    await renderPage("//evil");

    completeOnboardingMock.mockImplementationOnce(async () => ({
      kind: "completed",
      redirectTo: "unused",
    }));
    await formCapture.action!(new FormData());

    const [, redirectTo] = completeOnboardingMock.mock.calls[0];
    expect(redirectTo).toBe("/app");
  });

  it("collapses an array `next` to /app", async () => {
    createClientMock.mockResolvedValue(authOnlyClient({ id: "user-a" }));
    getAuthUserMock.mockResolvedValue(USER_A);

    await renderPage(["/app", "//evil"]);

    completeOnboardingMock.mockImplementationOnce(async () => ({
      kind: "completed",
      redirectTo: "unused",
    }));
    await formCapture.action!(new FormData());

    const [, redirectTo] = completeOnboardingMock.mock.calls[0];
    expect(redirectTo).toBe("/app");
  });

  it("keeps a valid internal `next` despite a hostile FormData next", async () => {
    createClientMock.mockResolvedValue(authOnlyClient({ id: "user-a" }));
    getAuthUserMock.mockResolvedValue(USER_A);

    await renderPage("/dashboard");

    completeOnboardingMock.mockImplementationOnce(async () => ({
      kind: "completed",
      redirectTo: "unused",
    }));
    const fd = new FormData();
    fd.set("next", "//evil");
    await formCapture.action!(fd);

    const [, redirectTo] = completeOnboardingMock.mock.calls[0];
    expect(redirectTo).toBe("/dashboard");
  });

  it("redirects to /auth with the encoded redirect when there is no verified user, without reading the profile", async () => {
    createClientMock.mockResolvedValue(authOnlyClient(null));

    await expect(renderPage("/dashboard")).rejects.toThrow(
      "__REDIRECT__:/auth?next=%2Fdashboard",
    );
    expect(getAuthUserMock).not.toHaveBeenCalled();
    expect(formCapture.action).toBeNull();
  });

  it("throws a sanitized message and renders nothing when the projection is null", async () => {
    createClientMock.mockResolvedValue(authOnlyClient({ id: "user-a" }));
    getAuthUserMock.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow("Perfil indisponível.");
    expect(formCapture.action).toBeNull();
  });

  it("throws a sanitized message and renders nothing when the projection id mismatches auth", async () => {
    createClientMock.mockResolvedValue(authOnlyClient({ id: "user-a" }));
    getAuthUserMock.mockResolvedValue({ ...USER_A, id: "user-b" });

    await expect(renderPage()).rejects.toThrow("Perfil indisponível.");
    expect(formCapture.action).toBeNull();
  });

  it("redirects to the safe destination when already onboarded", async () => {
    createClientMock.mockResolvedValue(authOnlyClient({ id: "user-a" }));
    getAuthUserMock.mockResolvedValue({ ...USER_A, onboarded: true });

    await expect(renderPage("/dashboard")).rejects.toThrow(
      "__REDIRECT__:/dashboard",
    );
    expect(formCapture.action).toBeNull();
  });
});
