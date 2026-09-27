import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_AI_CONSENT_VERSION } from "@/lib/ai-consent";
import type { Bootstrap, Me } from "@/types/ledger";
import type { AppState } from "@/stores/app-store";
import { useAppStore } from "@/stores/app-store";
import { runBootstrap } from "./bootstrap";
import {
  assertAiConsentAttempt,
  canUseAi,
  captureAiConsentAttempt,
  grantAiConsent,
  invalidateAiConsent,
  isAiConsentAttemptCurrent,
  revokeAiConsent,
} from "./ai-consent";

vi.mock("./client", async () => {
  const actual = (await vi.importActual("./client")) as Record<string, unknown>;
  return {
    ...actual,
    rpc: vi.fn(),
    getSupabase: vi.fn(),
  };
});

import { advanceAuthGeneration, getAuthGeneration, rpc } from "./client";

const GRANTED_AT = "2026-01-01T00:00:00.000Z";

function meFixture(id: string, consent: { version: number | null; grantedAt: string | null }): Me {
  return {
    id,
    handle: `user_${id}`,
    name: "Alguém",
    avatarUrl: null,
    isBot: false,
    email: `${id}@example.com`,
    pixKeyType: null,
    pixKeyHint: null,
    onboarded: true,
    notificationPreferences: { expenses: true, settlements: true, nudges: true },
    aiConsentVersion: consent.version,
    aiConsentGrantedAt: consent.grantedAt,
  };
}

const grantedA = () => meFixture("user-a", { version: CURRENT_AI_CONSENT_VERSION, grantedAt: GRANTED_AT });
const unconsentedA = () => meFixture("user-a", { version: null, grantedAt: null });
const grantedB = () => meFixture("user-b", { version: CURRENT_AI_CONSENT_VERSION, grantedAt: GRANTED_AT });

function seedReady(me: Me): void {
  useAppStore.setState({
    hydrated: true,
    bootstrapStatus: "ready",
    lastBootstrappedAccountId: me.id,
    lastBootstrappedGeneration: getAuthGeneration(),
    me,
  });
}

function revokeLocally(): void {
  useAppStore.getState().patch((s) =>
    s.me
      ? {
          me: { ...s.me, aiConsentVersion: null, aiConsentGrantedAt: null },
          aiConsentRevision: s.aiConsentRevision + 1,
        }
      : {},
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.getState().reset();
  vi.mocked(rpc).mockImplementation(() => new Promise(() => {}) as never);
});

describe("canUseAi", () => {
  it("requires this generation's committed bootstrap with current consent", () => {
    expect(canUseAi()).toBe(false);

    seedReady(grantedA());
    expect(canUseAi()).toBe(true);
  });

  it("a background or failed refresh never locks a consented user out", () => {
    seedReady(grantedA());

    useAppStore.setState({ bootstrapStatus: "loading" });
    expect(canUseAi()).toBe(true);

    useAppStore.setState({ bootstrapStatus: "error", bootstrapErrorCode: "network" });
    expect(canUseAi()).toBe(true);
  });

  it("refuses a usable grant persisted before this generation bootstrapped", () => {
    useAppStore.setState({
      hydrated: true,
      bootstrapStatus: "idle",
      lastBootstrappedAccountId: "user-a",
      lastBootstrappedGeneration: null,
      me: grantedA(),
    });
    expect(canUseAi()).toBe(false);
    expect(() => captureAiConsentAttempt()).toThrowError(expect.objectContaining({ code: "ai_consent_required" }));
  });

  it("refuses a grant left over from a previous auth generation", () => {
    seedReady(grantedA());
    advanceAuthGeneration();

    expect(canUseAi()).toBe(false);
  });

  it("blocks attempts while a consent mutation is pending", () => {
    seedReady(grantedA());
    useAppStore.setState({ aiConsentMutationPending: true });
    expect(canUseAi()).toBe(false);
    expect(() => captureAiConsentAttempt()).toThrowError(expect.objectContaining({ code: "ai_consent_required" }));
  });
});

describe("consent attempts", () => {
  it("captures account, generation and revision for a permitted state", () => {
    seedReady(grantedA());
    const attempt = captureAiConsentAttempt();
    expect(attempt).toEqual({ accountId: "user-a", authGeneration: getAuthGeneration(), consentRevision: 0 });
    expect(isAiConsentAttemptCurrent(attempt)).toBe(true);
  });

  it("throws AbortError once the revision moves and stops matching afterwards", () => {
    seedReady(grantedA());
    const attempt = captureAiConsentAttempt();
    revokeLocally();
    expect(isAiConsentAttemptCurrent(attempt)).toBe(false);
    expect(() => assertAiConsentAttempt(attempt)).toThrowError(
      expect.objectContaining({ name: "AbortError" }),
    );
  });

  it("a denied API response cannot invalidate another account", () => {
    seedReady(grantedA());
    const attempt = captureAiConsentAttempt();

    useAppStore.getState().reset();
    seedReady(grantedB());
    invalidateAiConsent(attempt);

    const state = useAppStore.getState();
    expect(state.me?.aiConsentVersion).toBe(CURRENT_AI_CONSENT_VERSION);
    expect(state.me?.id).toBe("user-b");
  });
});

describe("grantAiConsent", () => {
  it("publishes only after the server acknowledges the write", async () => {
    seedReady(unconsentedA());
    const pending = Promise.withResolvers<Me>();
    vi.mocked(rpc).mockImplementationOnce(() => pending.promise as never);

    const saving = grantAiConsent();
    await Promise.resolve();

    const during: AppState = useAppStore.getState();
    expect(during.aiConsentMutationPending).toBe(true);
    expect(during.me?.aiConsentVersion).toBeNull();
    expect(during.aiConsentRevision).toBe(1);
    expect(canUseAi()).toBe(false);

    pending.resolve(meFixture("user-a", { version: CURRENT_AI_CONSENT_VERSION, grantedAt: GRANTED_AT }));
    await saving;

    const after = useAppStore.getState();
    expect(after.me?.aiConsentVersion).toBe(CURRENT_AI_CONSENT_VERSION);
    expect(after.me?.aiConsentGrantedAt).toBe(GRANTED_AT);
    expect(after.aiConsentMutationPending).toBe(false);
    expect(after.aiConsentRevision).toBe(2);
    expect(canUseAi()).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "set_ai_consent",
      { p_expected_user_id: "user-a", p_version: CURRENT_AI_CONSENT_VERSION },
      expect.any(Function),
    );
  });

  it("rejects a concurrent mutation instead of queueing a second write", async () => {
    seedReady(unconsentedA());
    const pending = Promise.withResolvers<Me>();
    vi.mocked(rpc).mockImplementationOnce(() => pending.promise as never);

    const first = grantAiConsent();
    await expect(grantAiConsent()).rejects.toMatchObject({ code: "invalid_argument" });

    pending.resolve(meFixture("user-a", { version: CURRENT_AI_CONSENT_VERSION, grantedAt: GRANTED_AT }));
    await first;
  });

  it("rejects a response whose id belongs to another account", async () => {
    seedReady(unconsentedA());
    vi.mocked(rpc).mockImplementationOnce(() =>
      Promise.resolve(grantedB()) as never,
    );

    await expect(grantAiConsent()).rejects.toMatchObject({ code: "invalid_wire" });
    const state = useAppStore.getState();
    expect(state.me?.aiConsentVersion).toBeNull();
    expect(state.aiConsentMutationPending).toBe(false);
    expect(state.aiConsentRevision).toBe(1);
  });

  it("a late result after an account switch never publishes", async () => {
    seedReady(unconsentedA());
    const pending = Promise.withResolvers<Me>();
    vi.mocked(rpc).mockImplementationOnce(() => pending.promise as never);

    const saving = grantAiConsent();
    advanceAuthGeneration();
    useAppStore.getState().reset();
    seedReady(grantedB());
    useAppStore.getState().patch(() => ({ aiConsentMutationPending: false }));

    pending.resolve(meFixture("user-a", { version: CURRENT_AI_CONSENT_VERSION, grantedAt: GRANTED_AT }));
    await expect(saving).rejects.toThrowError(
      expect.objectContaining({ name: "AbortError" }),
    );

    const state = useAppStore.getState();
    expect(state.me?.id).toBe("user-b");
    expect(state.me?.aiConsentGrantedAt).toBe(GRANTED_AT);
    expect(state.aiConsentMutationPending).toBe(false);
  });

  it("a late result from the first session never publishes into a newer session of the same account", async () => {
    seedReady(unconsentedA());
    const pending = Promise.withResolvers<Me>();
    vi.mocked(rpc).mockImplementationOnce(() => pending.promise as never);

    const saving = grantAiConsent();
    advanceAuthGeneration();
    useAppStore.getState().reset();
    seedReady(unconsentedA());
    useAppStore.getState().patch(() => ({ aiConsentMutationPending: false }));

    pending.resolve(meFixture("user-a", { version: CURRENT_AI_CONSENT_VERSION, grantedAt: GRANTED_AT }));
    await expect(saving).rejects.toThrowError(
      expect.objectContaining({ name: "AbortError" }),
    );

    const state = useAppStore.getState();
    expect(state.me?.id).toBe("user-a");
    expect(state.me?.aiConsentVersion).toBeNull();
    expect(state.aiConsentMutationPending).toBe(false);
  });

  it("requires this generation's committed same-account bootstrap", async () => {
    useAppStore.setState({
      hydrated: true,
      bootstrapStatus: "idle",
      lastBootstrappedAccountId: "user-a",
      lastBootstrappedGeneration: null,
      me: unconsentedA(),
    });
    await expect(grantAiConsent()).rejects.toMatchObject({ code: "network" });

    useAppStore.getState().reset();
    await expect(grantAiConsent()).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("revokeAiConsent", () => {
  it("publishes the revoked pair only after acknowledgment", async () => {
    seedReady(grantedA());
    vi.mocked(rpc).mockImplementationOnce((() =>
      Promise.resolve(meFixture("user-a", { version: null, grantedAt: null }))) as never);

    await revokeAiConsent();

    const state = useAppStore.getState();
    expect(state.me?.aiConsentVersion).toBeNull();
    expect(state.me?.aiConsentGrantedAt).toBeNull();
    expect(canUseAi()).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      "revoke_ai_consent",
      { p_expected_user_id: "user-a" },
      expect.any(Function),
    );
  });

  it("a failed revoke stays an error and keeps the existing grant", async () => {
    seedReady(grantedA());
    const pending = Promise.withResolvers<Me>();
    vi.mocked(rpc).mockImplementationOnce(() => pending.promise as never);

    const revoking = revokeAiConsent();
    pending.reject(new Error("network down"));

    await expect(revoking).rejects.toThrow("network down");
    const state = useAppStore.getState();
    expect(state.me?.aiConsentVersion).toBe(CURRENT_AI_CONSENT_VERSION);
    expect(state.me?.aiConsentGrantedAt).toBe(GRANTED_AT);
    expect(state.aiConsentMutationPending).toBe(false);
    expect(state.aiConsentRevision).toBe(1);
    expect(canUseAi()).toBe(true);
  });
});

describe("bootstrap consent protection", () => {
  function bootstrapFor(me: Me): Bootstrap {
    return { me, groups: [], serverTime: "2026-01-02T00:00:00.000Z" };
  }

  it("a stale bootstrap response cannot overwrite a newer local revocation", async () => {
    seedReady(grantedA());
    useAppStore.getState().patch(() => ({ aiConsentRevision: 1 }));
    const pending = Promise.withResolvers<Bootstrap>();
    vi.mocked(rpc).mockImplementationOnce(() => pending.promise as never);

    const loading = runBootstrap();
    revokeLocally();
    pending.resolve(bootstrapFor(grantedA()));
    await loading;

    const state = useAppStore.getState();
    expect(state.bootstrapStatus).toBe("ready");
    expect(state.me?.aiConsentVersion).toBeNull();
    expect(state.me?.aiConsentGrantedAt).toBeNull();
    expect(state.lastBootstrappedAccountId).toBe("user-a");
  });

  it("a stale bootstrap response cannot overwrite a newer local grant", async () => {
    seedReady(unconsentedA());
    const pending = Promise.withResolvers<Bootstrap>();
    vi.mocked(rpc).mockImplementationOnce(() => pending.promise as never);

    const loading = runBootstrap();
    useAppStore.getState().patch(() => ({
      me: grantedA(),
      aiConsentRevision: 1,
      aiConsentMutationPending: false,
    }));
    pending.resolve(bootstrapFor(unconsentedA()));
    await loading;

    const state = useAppStore.getState();
    expect(state.bootstrapStatus).toBe("ready");
    expect(state.me?.aiConsentVersion).toBe(CURRENT_AI_CONSENT_VERSION);
    expect(state.me?.aiConsentGrantedAt).toBe(GRANTED_AT);
  });
});
