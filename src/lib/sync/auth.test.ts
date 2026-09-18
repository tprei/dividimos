import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bootstrap, Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { attachAuthListener, signOut } from "./auth";
import { rpc } from "./client";
import { runBootstrap } from "./bootstrap";

vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return {
    getAuthGeneration: actual.getAuthGeneration,
    advanceAuthGeneration: actual.advanceAuthGeneration,
    rpc: vi.fn(),
    getSupabase: vi.fn(),
  };
});

const mockDetachPush = vi.fn(async () => {});
const mockLocalDetach = vi.fn<(accountId: string | null) => void>();
vi.mock("@/lib/push/detach", () => ({
  detachPushForSignOut: () => mockDetachPush(),
  detachLocalPushForSignOut: (accountId: string | null) => mockLocalDetach(accountId),
}));

const mockSignOut = vi.fn();
vi.mock("./mutations-group", () => ({
  clearPendingVendorChargeCancellations: vi.fn(),
}));

type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "INITIAL_SESSION";
type AuthHandler = (event: AuthEvent, session: { user: { id: string } } | null) => void;

const handlers: AuthHandler[] = [];
const unsubscribe = vi.fn();

function me(id: string): Me {
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
  };
}

function bootstrapFor(id: string): Bootstrap {
  return { me: me(id), groups: [], serverTime: "2026-01-01T00:00:00.000Z" };
}

function emit(event: AuthEvent, userId: string | null) {
  for (const handler of handlers) {
    handler(event, userId === null ? null : { user: { id: userId } });
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  handlers.length = 0;
  useAppStore.getState().reset();
  const { useBillStore } = await import("@/stores/bill-store");
  useBillStore.getState().reset();
  window.localStorage.clear();
  // Listener-driven re-bootstraps must not consume a queued response; only the
  // requests a test explicitly resolves are allowed to settle.
  vi.mocked(rpc).mockImplementation(() => new Promise(() => {}) as never);
  mockSignOut.mockResolvedValue({ error: null });

  const { getSupabase } = await import("./client");
  vi.mocked(getSupabase).mockReturnValue({
    auth: {
      onAuthStateChange: (handler: AuthHandler) => {
        handlers.push(handler);
        return { data: { subscription: { unsubscribe } } };
      },
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  } as never);
});

describe("bootstrap account epoch", () => {
  it("drops a pending bootstrap after sign-out but keeps a same-user refresh", async () => {
    const detach = attachAuthListener(() => {}, () => {});

    const first = Promise.withResolvers<Bootstrap>();
    vi.mocked(rpc).mockReturnValueOnce(first.promise as never);
    const pending = runBootstrap();

    emit("SIGNED_OUT", null);
    first.resolve(bootstrapFor("user-a"));
    await pending;

    expect(useAppStore.getState().me).toBeNull();

    const second = Promise.withResolvers<Bootstrap>();
    vi.mocked(rpc).mockReturnValueOnce(second.promise as never);
    const afterRefresh = runBootstrap();
    emit("TOKEN_REFRESHED", "user-a");
    second.resolve(bootstrapFor("user-a"));
    await afterRefresh;

    expect(useAppStore.getState().me?.id).toBe("user-a");
    detach();
  });

  it("reboots the same account after a sign-out event", async () => {
    const detach = attachAuthListener(() => {}, () => {});
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    emit("SIGNED_OUT", null);

    const fresh = Promise.withResolvers<Bootstrap>();
    vi.mocked(rpc).mockReturnValueOnce(fresh.promise as never);
    emit("SIGNED_IN", "user-a");
    fresh.resolve(bootstrapFor("user-a"));

    await vi.waitFor(() => expect(useAppStore.getState().me?.id).toBe("user-a"));
    detach();
  });

  it("drops account A's pending bootstrap across A to B to A", async () => {
    const detach = attachAuthListener(() => {}, () => {});
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    const stale = Promise.withResolvers<Bootstrap>();
    vi.mocked(rpc).mockReturnValueOnce(stale.promise as never);
    const pending = runBootstrap();

    // Signing in as B resets the store; signing back in as A must still be
    // treated as a new identity even though the store is momentarily empty.
    emit("SIGNED_IN", "user-b");
    emit("SIGNED_IN", "user-a");

    stale.resolve(bootstrapFor("user-a"));
    await pending;

    expect(useAppStore.getState().me).toBeNull();
    detach();
  });

  it("ignores a repeated sign-in for the same user", async () => {
    const detach = attachAuthListener(() => {}, () => {});
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    emit("SIGNED_IN", "user-a");
    emit("INITIAL_SESSION", "user-a");

    expect(useAppStore.getState().me?.id).toBe("user-a");
    expect(rpc).not.toHaveBeenCalled();
    detach();
  });

  it("does not let a torn-down root publish into a remounted root", async () => {
    const detach = attachAuthListener(() => {}, () => {});

    const stale = Promise.withResolvers<Bootstrap>();
    vi.mocked(rpc).mockReturnValueOnce(stale.promise as never);
    const pending = runBootstrap();

    detach();
    attachAuthListener(() => {}, () => {});

    stale.resolve(bootstrapFor("user-a"));
    await pending;

    expect(useAppStore.getState().me).toBeNull();
  });
  it("ignores an auth event queued after the listener is detached", () => {
    const detach = attachAuthListener(() => {}, () => {});
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    detach();
    emit("SIGNED_OUT", null);

    expect(useAppStore.getState().me?.id).toBe("user-a");
  });

  it("starts a fresh request instead of reusing an invalidated one", async () => {
    const detach = attachAuthListener(() => {}, () => {});

    const stale = Promise.withResolvers<Bootstrap>();
    vi.mocked(rpc).mockReturnValueOnce(stale.promise as never);
    const pending = runBootstrap();

    emit("SIGNED_OUT", null);

    const fresh = Promise.withResolvers<Bootstrap>();
    vi.mocked(rpc).mockReturnValueOnce(fresh.promise as never);
    const next = runBootstrap();
    expect(rpc).toHaveBeenCalledTimes(2);

    stale.resolve(bootstrapFor("user-a"));
    fresh.resolve(bootstrapFor("user-b"));
    await Promise.all([pending, next]);

    expect(useAppStore.getState().me?.id).toBe("user-b");
    detach();
  });
});

describe("bill draft account isolation", () => {
  it("SIGNED_OUT clears the in-memory draft and archives the account draft", async () => {
    const { useBillStore } = await import("@/stores/bill-store");
    useBillStore.getState().reset();
    window.localStorage.clear();
    const detach = attachAuthListener(() => {}, () => {});
    emit("SIGNED_IN", "user-a");
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));
    useBillStore.getState().setCurrentUser({
      id: "user-a",
      email: "a@example.com",
      handle: "alice",
      name: "Alice",
      pixKeyType: "email",
      pixKeyHint: "",
      onboarded: true,
      createdAt: "",
    });
    useBillStore.getState().createExpense("Churrasco", "itemized");
    useBillStore.getState().addItem({
      description: "Carne",
      quantity: 1000,
      unitPriceCents: 9000,
      totalPriceCents: 9000,
    });

    emit("SIGNED_OUT", null);

    expect(useBillStore.getState().expense).toBeNull();
    expect(useBillStore.getState().items).toHaveLength(0);
    expect(window.localStorage.getItem(`${useBillStore.persist.getOptions().name}:user-a`)).not.toBeNull();
    detach();
  });

  it("switching A -> B -> A isolates drafts and restores A on return", async () => {
    const { useBillStore } = await import("@/stores/bill-store");
    useBillStore.getState().reset();
    window.localStorage.clear();
    const detach = attachAuthListener(() => {}, () => {});
    emit("SIGNED_IN", "user-a");
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    useBillStore.getState().setCurrentUser({
      id: "user-a",
      email: "a@example.com",
      handle: "alice",
      name: "Alice",
      pixKeyType: "email",
      pixKeyHint: "",
      onboarded: true,
      createdAt: "",
    });
    useBillStore.getState().createExpense("Churrasco", "itemized");

    emit("SIGNED_IN", "user-b");
    expect(useBillStore.getState().expense).toBeNull();
    expect(window.localStorage.getItem(`${useBillStore.persist.getOptions().name}:user-a`)).not.toBeNull();
    useBillStore.getState().createExpense("Passeio", "itemized");

    emit("SIGNED_IN", "user-a");
    expect(useBillStore.getState().expense?.title).toBe("Churrasco");
    detach();
  });
});

describe("sign-out push detach", () => {
  it("detaches this device's push before dropping the session", async () => {
    const order: string[] = [];
    mockDetachPush.mockImplementation(async () => {
      order.push("detach");
    });
    mockSignOut.mockImplementation(async () => {
      order.push("signOut");
      return { error: null };
    });

    const result = await signOut();

    expect(result).toEqual({ ok: true });
    expect(order).toEqual(["detach", "signOut"]);
    expect(mockDetachPush).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("drops local push delivery when the session ends elsewhere", async () => {
    const detach = attachAuthListener(() => {}, () => {});
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    emit("SIGNED_OUT", null);

    await vi.waitFor(() => {
      expect(mockLocalDetach).toHaveBeenCalledWith("user-a");
    });
    expect(useAppStore.getState().me).toBeNull();
    detach();
  });
});
