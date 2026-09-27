import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CURRENT_AI_CONSENT_VERSION } from "@/lib/ai-consent";
import { useAppStore } from "@/stores/app-store";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAiConsentGate } from "./use-ai-consent-gate";
import type * as AiConsentSync from "@/lib/sync/ai-consent";

const mockGrant = vi.fn();
const mockRunBootstrap = vi.fn();

vi.mock("@/lib/sync/ai-consent", async (importOriginal) => {
  const actual = await importOriginal<typeof AiConsentSync>();
  return { ...actual, grantAiConsent: (...args: unknown[]) => mockGrant(...args) };
});

vi.mock("@/lib/sync/bootstrap", () => ({
  runBootstrap: (...args: unknown[]) => mockRunBootstrap(...args),
}));

function makeMe(id: string, granted: boolean) {
  return {
    id,
    handle: id,
    name: id,
    avatarUrl: null,
    isBot: false,
    email: `${id}@example.com`,
    pixKeyType: null,
    pixKeyHint: null,
    onboarded: true,
    notificationPreferences: {},
    aiConsentVersion: granted ? CURRENT_AI_CONSENT_VERSION : null,
    aiConsentGrantedAt: granted ? "2026-01-01T00:00:00.000Z" : null,
  };
}

function seedAccount(id: string, granted: boolean, bootstrapStatus: "ready" | "error" | "loading" | "idle" = "ready"): void {
  useAppStore.getState().reset();
  useAppStore.setState({
    bootstrapStatus,
    lastBootstrappedAccountId: bootstrapStatus === "ready" ? id : null,
    lastBootstrappedGeneration: bootstrapStatus === "ready" ? 0 : null,
    me: makeMe(id, granted),
  });
}

describe("useAiConsentGate", () => {
  beforeEach(() => {
    mockGrant.mockReset();
    mockRunBootstrap.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true without opening when AI is already usable", () => {
    seedAccount("user-1", true);
    const onDecline = vi.fn();
    const { result } = renderHook(() => useAiConsentGate(onDecline));

    let accepted = false;
    act(() => {
      accepted = result.current.requestConsent();
    });

    expect(accepted).toBe(true);
    expect(result.current.dialogProps.open).toBe(false);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("decline does not call grant and runs the decline callback", () => {
    seedAccount("user-1", false);
    const onDecline = vi.fn();
    const { result } = renderHook(() => useAiConsentGate(onDecline));

    let accepted = true;
    act(() => {
      accepted = result.current.requestConsent();
    });

    expect(accepted).toBe(false);
    expect(result.current.dialogProps.open).toBe(true);

    act(() => {
      result.current.dialogProps.onDecline();
    });

    expect(mockGrant).not.toHaveBeenCalled();
    expect(onDecline).toHaveBeenCalledOnce();
    expect(result.current.dialogProps.open).toBe(false);
  });

  it("a failed save stays in the dialog with an error and retries the grant", async () => {
    seedAccount("user-1", false);
    const onDecline = vi.fn();
    const { result } = renderHook(() => useAiConsentGate(onDecline));

    act(() => {
      result.current.requestConsent();
    });
    mockGrant.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      result.current.dialogProps.onAccept();
    });

    expect(result.current.dialogProps.open).toBe(true);
    expect(result.current.dialogProps.state).toMatchObject({
      status: "error",
      operation: "grant",
      message: "Não foi possível salvar sua permissão. Tente novamente.",
    });
    expect(onDecline).not.toHaveBeenCalled();

    mockGrant.mockResolvedValueOnce(undefined);
    await act(async () => {
      result.current.dialogProps.onRetry();
    });

    expect(mockGrant).toHaveBeenCalledTimes(2);
    expect(result.current.dialogProps.state).toMatchObject({ status: "success" });
  });

  it("an accepted grant shows success, closes without declining, and the next request passes", async () => {
    seedAccount("user-1", false);
    const onDecline = vi.fn();
    const { result } = renderHook(() => useAiConsentGate(onDecline));

    act(() => {
      result.current.requestConsent();
    });
    mockGrant.mockImplementationOnce(async () => {
      useAppStore.setState({
        me: makeMe("user-1", true),
        aiConsentRevision: useAppStore.getState().aiConsentRevision + 1,
      });
    });
    await act(async () => {
      result.current.dialogProps.onAccept();
    });

    expect(result.current.dialogProps.state).toMatchObject({ status: "success" });
    expect(onDecline).not.toHaveBeenCalled();

    act(() => {
      result.current.dialogProps.onClose();
    });

    expect(result.current.dialogProps.open).toBe(false);
    let accepted = false;
    act(() => {
      accepted = result.current.requestConsent();
    });

    expect(accepted).toBe(true);
  });

  it("an account switch closes the prompt and ignores a late save", async () => {
    seedAccount("user-1", false);
    const onDecline = vi.fn();
    const { result } = renderHook(() => useAiConsentGate(onDecline));

    let releaseGrant: (() => void) | null = null;
    mockGrant.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseGrant = () => {
            useAppStore.setState({
              me: makeMe("user-1", true),
              aiConsentRevision: useAppStore.getState().aiConsentRevision + 1,
            });
            resolve();
          };
        }),
    );

    act(() => {
      result.current.requestConsent();
    });
    expect(result.current.dialogProps.open).toBe(true);

    // The shared device now belongs to another account.
    act(() => {
      seedAccount("user-2", false);
    });
    await waitFor(() => {
      expect(result.current.dialogProps.open).toBe(false);
    });
    expect(onDecline).not.toHaveBeenCalled();

    await act(async () => {
      releaseGrant?.();
    });

    expect(result.current.dialogProps.open).toBe(false);
    expect(result.current.dialogProps.state.status).not.toBe("success");
  });

  it("a bootstrap failure asks for verification with retry and never grants", async () => {
    seedAccount("user-1", false, "error");
    const onDecline = vi.fn();
    const { result } = renderHook(() => useAiConsentGate(onDecline));

    act(() => {
      result.current.requestConsent();
    });

    expect(result.current.dialogProps.state).toMatchObject({
      status: "error",
      operation: "bootstrap",
      message: "Não foi possível verificar sua permissão de IA. Tente novamente.",
    });

    mockRunBootstrap.mockResolvedValueOnce(undefined);
    await act(async () => {
      result.current.dialogProps.onRetry();
    });

    expect(mockRunBootstrap).toHaveBeenCalledOnce();
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("a loading bootstrap renders the verification state until it settles", async () => {
    seedAccount("user-1", false, "loading");
    const { result } = renderHook(() => useAiConsentGate(onDeclineNever));

    act(() => {
      result.current.requestConsent();
    });

    expect(result.current.dialogProps.state).toMatchObject({
      status: "loading",
      operation: "bootstrap",
    });

    act(() => {
      useAppStore.setState({
        bootstrapStatus: "ready",
        lastBootstrappedAccountId: "user-1",
        lastBootstrappedGeneration: 0,
      });
    });

    await waitFor(() => {
      expect(result.current.dialogProps.state.status).toBe("idle");
    });
  });

  it("a failed background refresh never downgrades a committed prompt to verification", async () => {
    seedAccount("user-1", false, "ready");
    const { result } = renderHook(() => useAiConsentGate(onDeclineNever));

    act(() => {
      result.current.requestConsent();
    });
    expect(result.current.dialogProps.state.status).toBe("idle");

    act(() => {
      useAppStore.setState({ bootstrapStatus: "error", bootstrapErrorCode: "network" });
    });

    expect(result.current.dialogProps.state).toMatchObject({ status: "idle" });
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("bootstrap landing with a granted consent closes the prompt", async () => {
    seedAccount("user-1", false, "loading");
    const { result } = renderHook(() => useAiConsentGate(onDeclineNever));

    act(() => {
      result.current.requestConsent();
    });

    act(() => {
      useAppStore.setState({
        bootstrapStatus: "ready",
        lastBootstrappedAccountId: "user-1",
        lastBootstrappedGeneration: 0,
        me: makeMe("user-1", true),
        aiConsentRevision: useAppStore.getState().aiConsentRevision + 1,
      });
    });

    await waitFor(() => {
      expect(result.current.dialogProps.open).toBe(false);
    });
  });
});

function onDeclineNever(): void {
  throw new Error("decline must not run in this test");
}
