import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bootstrap, Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import {
  attachAuthListener,
  clearAccountDeletionMarker,
  completeAccountDeletionSignOut,
  signOut,
} from "./auth";
import { getAuthGeneration, rpc } from "./client";
import { runBootstrap } from "./bootstrap";
import type * as RefreshModule from "./refresh";

vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return {
    getAuthGeneration: actual.getAuthGeneration,
    advanceAuthGeneration: actual.advanceAuthGeneration,
    rpc: vi.fn(),
    getSupabase: vi.fn(),
  };
});
vi.mock("./refresh", async () => ({
  ...(await vi.importActual<typeof RefreshModule>("./refresh")),
  refreshHostedAssignmentRooms: vi.fn(async () => {}),
  readUserBlocks: vi.fn(async () => []),
}));

const mockDetachPush = vi.fn(async () => {});
const mockLocalDetach = vi.fn<(accountId: string | null) => void>();
vi.mock("@/lib/push/detach", () => ({
  detachPushForSignOut: () => mockDetachPush(),
  detachLocalPushForSignOut: (accountId: string | null) => mockLocalDetach(accountId),
}));

const mockForgetGoogle = vi.fn<() => Promise<void>>();
const mockForgetApple = vi.fn<() => Promise<void>>();
vi.mock("@/lib/capacitor/auth", () => ({
  forgetGoogleAccount: () => mockForgetGoogle(),
  forgetAppleAccount: () => mockForgetApple(),
}));

const mockClearPendingSignInName = vi.fn();
vi.mock("@/lib/pending-sign-in-name", () => ({
  clearPendingSignInName: () => mockClearPendingSignInName(),
}));

const mockSignOut = vi.fn();
vi.mock("./mutations-group", () => ({
  clearPendingVendorChargeCancellations: vi.fn(),
}));

const mockClearSessionCaches = vi.fn();
vi.mock("@/lib/platform/session-caches", () => ({
  clearSessionCaches: (...args: unknown[]) => mockClearSessionCaches(...args),
}));

type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "INITIAL_SESSION" | "USER_UPDATED";
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
  clearAccountDeletionMarker();
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

describe("account deletion sign-out", () => {
  it("skips archiving the deleted draft and still runs the shared teardown", async () => {
    const { useBillStore } = await import("@/stores/bill-store");
    const { setDraftOwner } = await import("@/lib/bill-draft-isolation");
    const { archiveCurrentDraft } = await import("@/lib/bill-draft-isolation");
    useBillStore.setState({ expense: null, items: [] });
    setDraftOwner("user-a");
    archiveCurrentDraft("user-a");
    const archiveKey = `${useBillStore.persist.getOptions().name}:user-a`;
    expect(window.localStorage.getItem(archiveKey)).not.toBeNull();

    const stop = attachAuthListener(() => {}, () => {});
    const result = await completeAccountDeletionSignOut("user-a");

    expect(result).toEqual({ ok: true });
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mockLocalDetach).toHaveBeenCalledWith("user-a");

    emit("SIGNED_OUT", "user-a");
    expect(window.localStorage.getItem(archiveKey)).not.toBeNull();
    stop();
    clearAccountDeletionMarker();
  });

  it("keeps archiving drafts for ordinary sign-outs without the marker", async () => {
    const { useBillStore } = await import("@/stores/bill-store");
    const { setDraftOwner, archiveCurrentDraft } = await import("@/lib/bill-draft-isolation");
    useBillStore.setState({ expense: null, items: [] });
    setDraftOwner("user-b");
    archiveCurrentDraft("user-b");
    const archiveKey = `${useBillStore.persist.getOptions().name}:user-b`;
    expect(window.localStorage.getItem(archiveKey)).not.toBeNull();

    const stop = attachAuthListener(() => {}, () => {});

    emit("SIGNED_OUT", "user-b");

    expect(window.localStorage.getItem(archiveKey)).not.toBeNull();
    stop();
  });
});

describe("bootstrap account epoch", () => {
  function queueBootstrapOnce(bootstrap: Promise<Bootstrap>): void {
    vi.mocked(rpc).mockReturnValueOnce(bootstrap as never);
  }

  it("drops a pending bootstrap after sign-out but keeps a same-user refresh", async () => {
    const detach = attachAuthListener(() => {}, () => {});

    const first = Promise.withResolvers<Bootstrap>();
    queueBootstrapOnce(first.promise);
    const pending = runBootstrap();

    emit("SIGNED_OUT", null);
    first.resolve(bootstrapFor("user-a"));
    await pending;

    expect(useAppStore.getState().me).toBeNull();

    const second = Promise.withResolvers<Bootstrap>();
    queueBootstrapOnce(second.promise);
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
    queueBootstrapOnce(fresh.promise);
    emit("SIGNED_IN", "user-a");
    fresh.resolve(bootstrapFor("user-a"));

    await vi.waitFor(() => expect(useAppStore.getState().me?.id).toBe("user-a"));
    detach();
  });

  it("drops account A's pending bootstrap across A to B to A", async () => {
    const detach = attachAuthListener(() => {}, () => {});
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    const stale = Promise.withResolvers<Bootstrap>();
    queueBootstrapOnce(stale.promise);
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
    queueBootstrapOnce(stale.promise);
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
    queueBootstrapOnce(stale.promise);
    const pending = runBootstrap();

    emit("SIGNED_OUT", null);

    const fresh = Promise.withResolvers<Bootstrap>();
    queueBootstrapOnce(fresh.promise);
    const next = runBootstrap();
    expect(rpc).toHaveBeenCalledTimes(2);

    stale.resolve(bootstrapFor("user-a"));
    fresh.resolve(bootstrapFor("user-b"));
    await Promise.all([pending, next]);

    expect(useAppStore.getState().me?.id).toBe("user-b");
    detach();
  });

  it("keeps the pending bootstrap when SIGNED_IN arrives before store hydration completes", async () => {
    useAppStore.setState({ hydrated: false, me: null });
    const initialGen = getAuthGeneration();

    const detach = attachAuthListener(() => {}, () => {});

    const first = Promise.withResolvers<Bootstrap>();
    queueBootstrapOnce(first.promise);
    const pending = runBootstrap();

    emit("SIGNED_IN", "user-a");

    useAppStore.setState({ hydrated: true, me: me("user-a") });

    first.resolve(bootstrapFor("user-a"));
    await pending;

    expect(getAuthGeneration()).toBe(initialGen);
    expect(useAppStore.getState().me?.id).toBe("user-a");
    detach();
  });
});

describe("assignment room credential isolation", () => {
  const roomKey = "dividimos.assignment-room.00000000-0000-4000-8000-000000000001";

  it("purges room capabilities on sign-out and signed-in account switches", () => {
    const detach = attachAuthListener(() => {}, () => {});
    localStorage.setItem(roomKey, JSON.stringify({ memberToken: "secret-a" }));
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    emit("SIGNED_IN", "user-b");
    expect(localStorage.getItem(roomKey)).toBeNull();

    localStorage.setItem(roomKey, JSON.stringify({ memberToken: "secret-b" }));
    emit("SIGNED_OUT", null);
    expect(localStorage.getItem(roomKey)).toBeNull();
    detach();
  });

  it("keeps an anonymous guest capability through first login and route teardown", () => {
    const detach = attachAuthListener(() => {}, () => {});
    localStorage.setItem(roomKey, JSON.stringify({ memberToken: "guest-secret" }));

    emit("SIGNED_IN", "user-a");
    expect(localStorage.getItem(roomKey)).not.toBeNull();

    detach();
    expect(localStorage.getItem(roomKey)).not.toBeNull();
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

  it("keeps the draft when SIGNED_IN for the same user arrives before store hydration completes", async () => {
    const { useBillStore } = await import("@/stores/bill-store");
    const { setDraftOwner } = await import("@/lib/bill-draft-isolation");
    useBillStore.getState().reset();
    window.localStorage.clear();

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
    setDraftOwner("user-a");

    useAppStore.setState({ hydrated: false, me: null });

    const detach = attachAuthListener(() => {}, () => {});
    emit("SIGNED_IN", "user-a");

    useAppStore.setState({ hydrated: true, me: me("user-a") });

    await vi.waitFor(() => {
      expect(useBillStore.getState().expense?.title).toBe("Churrasco");
    });
    expect(window.localStorage.getItem(useBillStore.persist.getOptions().name!)).not.toBeNull();
    detach();
  });

  it("returns to Supabase at once instead of holding its auth lock until hydration", () => {
    useAppStore.setState({ hydrated: false, me: null });
    const detach = attachAuthListener(() => {}, () => {});

    const returned: unknown = handlers[0]("SIGNED_IN", { user: { id: "user-a" } });

    expect(returned).toBeUndefined();
    detach();
  });

  it("replays a sign-out that raced ahead of hydration after the sign-in it followed", async () => {
    const { useBillStore } = await import("@/stores/bill-store");
    const { setDraftOwner } = await import("@/lib/bill-draft-isolation");
    useBillStore.getState().reset();
    window.localStorage.clear();
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
    setDraftOwner("user-a");
    useAppStore.setState({ hydrated: false, me: null });
    const onSignedOut = vi.fn();
    const detach = attachAuthListener(onSignedOut, () => {});

    emit("SIGNED_IN", "user-a");
    emit("SIGNED_OUT", null);
    expect(onSignedOut).not.toHaveBeenCalled();

    useAppStore.setState({ hydrated: true, me: me("user-a") });

    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
    expect(useAppStore.getState().me).toBeNull();
    expect(useBillStore.getState().expense).toBeNull();
    expect(window.localStorage.getItem(`${useBillStore.persist.getOptions().name}:user-a`)).not.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    detach();
  });
});

describe("sign-out push detach", () => {
  it("detaches push and forgets native Google and Apple accounts before dropping the session", async () => {
    const order: string[] = [];
    mockDetachPush.mockImplementation(async () => {
      order.push("detach");
    });
    mockForgetGoogle.mockImplementation(async () => {
      order.push("forgetGoogle");
    });
    mockForgetApple.mockImplementation(async () => {
      order.push("forgetApple");
    });
    mockSignOut.mockImplementation(async () => {
      order.push("signOut");
      return { error: null };
    });

    const result = await signOut();

    expect(result).toEqual({ ok: true });
    expect(order).toEqual(["detach", "forgetGoogle", "forgetApple", "signOut"]);
    expect(mockDetachPush).toHaveBeenCalledTimes(1);
    expect(mockForgetGoogle).toHaveBeenCalledTimes(1);
    expect(mockForgetApple).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("ignores USER_UPDATED events without resetting or bootstrapping", async () => {
    const onSignedOut = vi.fn();
    const detach = attachAuthListener(onSignedOut, () => {});
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    emit("USER_UPDATED", "user-a");

    expect(useAppStore.getState().me?.id).toBe("user-a");
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    detach();
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

  it("detaches push locally on a direct account switch without touching the server", async () => {
    const detach = attachAuthListener(() => {}, () => {});
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    emit("SIGNED_IN", "user-b");

    // A's row goes stale at FCM through the local detach; the authenticated
    // server detach must never run as B to remove A's token.
    expect(mockLocalDetach).toHaveBeenCalledWith("user-a");
    expect(mockDetachPush).not.toHaveBeenCalled();
    detach();
  });
});

describe("session caches on sign-out", () => {
  it("SIGNED_OUT drops the session caches and pending sign-in name", () => {
    const detach = attachAuthListener(() => {}, () => {});
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    emit("SIGNED_OUT", null);

    expect(mockClearSessionCaches).toHaveBeenCalledTimes(1);
    expect(mockClearPendingSignInName).toHaveBeenCalledTimes(1);
    detach();
  });

  it("keeps the session caches when a different account signs in", () => {
    const detach = attachAuthListener(() => {}, () => {});
    useAppStore.getState().applyBootstrap(bootstrapFor("user-a"));

    emit("SIGNED_IN", "user-b");

    expect(mockClearSessionCaches).not.toHaveBeenCalled();
    detach();
  });
});
