import { act, render, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/types";
import {
  UserProvider,
  useAuth,
  type AuthIdentitySnapshot,
} from "./user-context";

type RpcResult = { data: unknown; error: unknown };
type Session = { user?: { id: string } } | null;
type AuthCallback = (event: string, session: Session) => void;

// `Promise.withResolvers` is not available on the Node version CI runs unit
// tests with, so the deferred is built explicitly.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface RpcCall {
  name: string;
  args: unknown;
  settled: boolean;
  resolve: (result: RpcResult) => void;
  reject: (error: unknown) => void;
}

// Hoisted container shared between the module mock and the test bodies. The
// mock factory is hoisted above imports, so every piece of mutable state it
// touches must live here.
const harness = vi.hoisted(() => ({
  authCallback: null as AuthCallback | null,
  subscribeSpy: vi.fn(),
  unsubscribeSpy: vi.fn(),
  rpcCalls: [] as RpcCall[],
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (callback: AuthCallback) =>
        harness.subscribeSpy(callback),
    },
    // Each call returns a promise the test settles manually, in call order.
    rpc: (name: string, args?: unknown) => {
      const { promise, resolve, reject } = deferred<RpcResult>();
      const call: RpcCall = { name, args, settled: false, resolve, reject };
      harness.rpcCalls.push(call);
      return promise;
    },
  }),
}));

// Records every distinct context value the provider ever published, in order.
const snapshots: AuthIdentitySnapshot[] = [];

function Probe() {
  const value = useAuth();
  snapshots.push(value);
  return null;
}

const flushMicro = () => new Promise((resolve) => setTimeout(resolve));

function makeUser(id: string): User {
  return {
    id,
    email: `${id}@example.com`,
    handle: id.toLowerCase(),
    name: id,
    pixKeyType: "email",
    pixKeyHint: `${id[0]}***`,
    onboarded: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    notificationPreferences: { expenses: true },
  };
}

interface ProfileRow {
  id: string;
  email: string | null;
  handle: string | null;
  name: string;
  avatar_url: string | null;
  onboarded: boolean;
  created_at: string;
  notification_preferences: Record<string, boolean>;
  pix_key_type: string;
  pix_key_hint: string;
}

function makeRow(id: string): ProfileRow {
  return {
    id,
    email: `${id}@example.com`,
    handle: id.toLowerCase(),
    name: id,
    avatar_url: null,
    onboarded: true,
    created_at: "2025-01-01T00:00:00.000Z",
    notification_preferences: { expenses: true },
    pix_key_type: "email",
    pix_key_hint: `${id[0]}***`,
  };
}

type Rendered = RenderResult;

function mount(seed: User | null): Rendered {
  return render(
    <UserProvider initialUser={seed}>
      <Probe />
    </UserProvider>,
  );
}

function rerenderWith(utils: Rendered, seed: User | null) {
  utils.rerender(
    <UserProvider initialUser={seed}>
      <Probe />
    </UserProvider>,
  );
}

function emit(event: string, userId: string | null) {
  if (!harness.authCallback) throw new Error("auth listener not registered");
  act(() => {
    harness.authCallback!(
      event,
      userId === null ? null : { user: { id: userId } },
    );
  });
}

async function resolveRpc(index: number, data: unknown, error: unknown) {
  await act(async () => {
    const call = harness.rpcCalls[index];
    if (!call) throw new Error(`no rpc call at index ${index}`);
    call.settled = true;
    call.resolve({ data, error });
    await flushMicro();
  });
}

async function rejectRpc(index: number, error: unknown) {
  await act(async () => {
    const call = harness.rpcCalls[index];
    if (!call) throw new Error(`no rpc call at index ${index}`);
    call.settled = true;
    call.reject(error);
    await flushMicro();
  });
}

function lastSnapshot(): AuthIdentitySnapshot {
  return snapshots[snapshots.length - 1];
}

function expectState(
  status: AuthIdentitySnapshot["status"],
  userId: string | null,
  generation: number,
) {
  const s = lastSnapshot();
  expect(s.status).toBe(status);
  expect(s.userId).toBe(userId);
  expect(s.generation).toBe(generation);
}

describe("UserProvider identity state machine", () => {
  beforeEach(() => {
    harness.rpcCalls.length = 0;
    harness.authCallback = null;
    snapshots.length = 0;
    harness.subscribeSpy.mockReset();
    harness.unsubscribeSpy.mockReset();
    harness.subscribeSpy.mockImplementation((callback: AuthCallback) => {
      harness.authCallback = callback;
      return {
        data: { subscription: { unsubscribe: harness.unsubscribeSpy } },
      };
    });
  });

  // Across the whole suite: every profile read is the argument-free RPC and
  // never carries a target id.
  afterEach(() => {
    for (const call of harness.rpcCalls) {
      expect(call.name).toBe("get_my_profile");
      expect(call.args).toBeUndefined();
    }
  });

  it("publishes a seeded profile on mount with no RPC and stays put on an initial same-id session", () => {
    mount(makeUser("A"));
    expectState("authenticated", "A", 0);
    expect(lastSnapshot().user?.id).toBe("A");
    expect(harness.rpcCalls).toHaveLength(0);

    emit("INITIAL_SESSION", "A");
    expectState("authenticated", "A", 0);
    expect(harness.rpcCalls).toHaveLength(0);
  });

  it("ends unauthenticated at generation 0 with no RPC when the session is null", () => {
    mount(null);
    emit("INITIAL_SESSION", null);
    expectState("unauthenticated", null, 0);
    expect(lastSnapshot().user).toBeNull();
    expect(harness.rpcCalls).toHaveLength(0);
  });

  it("enters loading at generation 1 for a freshly observed id before the profile resolves", () => {
    mount(null);
    emit("SIGNED_IN", "A");
    expectState("loading", "A", 1);
    expect(lastSnapshot().user).toBeNull();
    expect(harness.rpcCalls).toHaveLength(1);
    expect(harness.rpcCalls[0].settled).toBe(false);
  });

  it("never publishes a profile success that settles after sign-out", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    emit("SIGNED_OUT", null);
    await resolveRpc(0, [makeRow("A")], null);
    expectState("unauthenticated", null, 2);
    expect(lastSnapshot().user).toBeNull();
    expect(snapshots.every((s) => s.user === null)).toBe(true);
  });

  it("never publishes a profile failure that settles after sign-out", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    emit("SIGNED_OUT", null);
    await rejectRpc(0, new Error("boom"));
    expectState("unauthenticated", null, 2);
    expect(lastSnapshot().user).toBeNull();
    expect(snapshots.every((s) => s.user === null)).toBe(true);
  });

  it("publishes only the newer account when the older profile settles first", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    emit("SIGNED_IN", "B");
    await resolveRpc(0, [makeRow("A")], null);
    expectState("loading", "B", 2);
    await resolveRpc(1, [makeRow("B")], null);
    expectState("authenticated", "B", 2);
    expect(lastSnapshot().user?.id).toBe("B");
  });

  it("publishes only the newer account when the newer profile settles first", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    emit("SIGNED_IN", "B");
    await resolveRpc(1, [makeRow("B")], null);
    expectState("authenticated", "B", 2);
    await resolveRpc(0, [makeRow("A")], null);
    expectState("authenticated", "B", 2);
    expect(lastSnapshot().user?.id).toBe("B");
  });

  it("a stale failure from a superseded account cannot clear or error the active request", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    emit("SIGNED_IN", "B");
    await rejectRpc(0, new Error("A failed"));
    expectState("loading", "B", 2);
    await resolveRpc(1, [makeRow("B")], null);
    expectState("authenticated", "B", 2);
  });

  it("clears a seeded profile when a superseding read fails and retries on a later same-id event", async () => {
    mount(makeUser("A"));
    emit("SIGNED_IN", "B");
    await rejectRpc(0, new Error("B failed"));
    expectState("error", "B", 1);
    expect(lastSnapshot().user).toBeNull();
    emit("SIGNED_IN", "B");
    expect(harness.rpcCalls).toHaveLength(2);
    await resolveRpc(1, [makeRow("B")], null);
    expectState("authenticated", "B", 1);
  });

  it("errors on a rejected profile request and retries on a later same-id event", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    await rejectRpc(0, new Error("network"));
    expectState("error", "A", 1);
    emit("SIGNED_IN", "A");
    expect(harness.rpcCalls).toHaveLength(2);
    await resolveRpc(1, [makeRow("A")], null);
    expectState("authenticated", "A", 1);
  });

  it("treats a result carrying an error as an error even when a matching row is present", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    await resolveRpc(0, [makeRow("A")], { message: "rls denied" });
    expectState("error", "A", 1);
    expect(lastSnapshot().user).toBeNull();
    expect(snapshots.every((s) => s.user === null)).toBe(true);
  });

  it("leaves the snapshot referentially identical when a stale superseded result settles", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    emit("SIGNED_IN", "B");
    const captured = lastSnapshot();
    expectState("loading", "B", 2);
    await resolveRpc(0, [makeRow("A")], { message: "late" });
    expect(lastSnapshot()).toBe(captured);
    expect(harness.rpcCalls[0].settled).toBe(true);
  });

  it.each<{ label: string; data: unknown }>([
    { label: "no rows", data: [] },
    { label: "multiple rows", data: [makeRow("A"), makeRow("A")] },
    {
      label: "decoder-rejected row",
      data: [{ ...makeRow("A"), pix_key_type: "bogus" }],
    },
    { label: "row id mismatch", data: [makeRow("B")] },
  ])("errors for the requested id when the result is invalid ($label)", async ({ data }) => {
    mount(null);
    emit("SIGNED_IN", "A");
    await resolveRpc(0, data, null);
    expectState("error", "A", 1);
    expect(lastSnapshot().user).toBeNull();
  });

  it("ignores a duplicate same-id signed-in event while already authenticated", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    await resolveRpc(0, [makeRow("A")], null);
    expectState("authenticated", "A", 1);
    emit("SIGNED_IN", "A");
    expect(harness.rpcCalls).toHaveLength(1);
    expectState("authenticated", "A", 1);
  });

  it("retries on a duplicate same-id event while in error", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    await rejectRpc(0, new Error("fail"));
    emit("SIGNED_IN", "A");
    expect(harness.rpcCalls).toHaveLength(2);
  });

  it("publishes only the newest result across repeated same-id user-updated events with a stable generation", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    emit("USER_UPDATED", "A");
    emit("USER_UPDATED", "A");
    await resolveRpc(0, [makeRow("A")], null);
    await resolveRpc(1, [makeRow("A")], null);
    expectState("loading", "A", 1);
    await resolveRpc(2, [makeRow("A")], null);
    expectState("authenticated", "A", 1);
    expect(snapshots.every((s) => s.generation <= 1)).toBe(true);
  });

  it("treats a same-id token-refreshed event as a no-op", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    await resolveRpc(0, [makeRow("A")], null);
    expect(harness.rpcCalls).toHaveLength(1);
    emit("TOKEN_REFRESHED", "A");
    expect(harness.rpcCalls).toHaveLength(1);
    expectState("authenticated", "A", 1);
  });

  it("clears the profile and advances the generation on an event carrying a different id", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    await resolveRpc(0, [makeRow("A")], null);
    emit("TOKEN_REFRESHED", "B");
    expectState("loading", "B", 2);
    expect(lastSnapshot().user).toBeNull();
  });

  it("issues an argument-free profile read on a mismatched seed rerender and publishes the bound id", async () => {
    const utils = mount(null);
    emit("SIGNED_IN", "B");
    expect(harness.rpcCalls).toHaveLength(1);
    rerenderWith(utils, makeUser("A"));
    expect(harness.rpcCalls).toHaveLength(2);
    await resolveRpc(1, [makeRow("B")], null);
    expectState("authenticated", "B", 1);
  });

  it("issues an argument-free profile read when a previously observed seed is replaced by null", async () => {
    const utils = mount(makeUser("A"));
    emit("SIGNED_IN", "B");
    expect(harness.rpcCalls).toHaveLength(1);
    rerenderWith(utils, null);
    expect(harness.rpcCalls).toHaveLength(2);
    await resolveRpc(1, [makeRow("B")], null);
    expectState("authenticated", "B", 1);
  });

  it("errors on an exact id mismatch when a mismatched seed rerender resolves to a different id", async () => {
    const utils = mount(null);
    emit("SIGNED_IN", "B");
    rerenderWith(utils, makeUser("A"));
    expect(harness.rpcCalls).toHaveLength(2);
    await resolveRpc(1, [makeRow("A")], null);
    expectState("error", "B", 1);
    expect(lastSnapshot().user).toBeNull();
    expect(snapshots.every((s) => s.user === null)).toBe(true);
  });

  it("invalidates the in-flight request on a same-id seed replacement without advancing the generation", async () => {
    const utils = mount(null);
    emit("SIGNED_IN", "A");
    expect(harness.rpcCalls).toHaveLength(1);
    rerenderWith(utils, makeUser("A"));
    expect(harness.rpcCalls).toHaveLength(1);
    expectState("authenticated", "A", 1);
    expect(lastSnapshot().user?.id).toBe("A");
    await resolveRpc(0, [makeRow("A")], null);
    expectState("authenticated", "A", 1);
    expect(snapshots.every((s) => s.generation <= 1)).toBe(true);
  });

  it("never exposes the previous account profile under a new id after an account switch", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    await resolveRpc(0, [makeRow("A")], null);
    emit("SIGNED_IN", "B");
    await resolveRpc(1, [makeRow("B")], null);
    for (const s of snapshots) {
      expect(s.user === null || s.user.id === s.userId).toBe(true);
    }
  });

  it("never exposes the previous account profile after sign-out", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    await resolveRpc(0, [makeRow("A")], null);
    emit("SIGNED_OUT", null);
    for (const s of snapshots) {
      expect(s.user === null || s.user.id === s.userId).toBe(true);
    }
  });

  it("keeps a single subscription across seed rerenders and unsubscribes once on unmount", () => {
    const utils = mount(null);
    rerenderWith(utils, makeUser("A"));
    rerenderWith(utils, makeUser("B"));
    rerenderWith(utils, null);
    expect(harness.subscribeSpy).toHaveBeenCalledTimes(1);
    expect(harness.unsubscribeSpy).toHaveBeenCalledTimes(0);
    utils.unmount();
    expect(harness.unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it("silently drops an in-flight profile result that settles after unmount", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const utils = mount(null);
    emit("SIGNED_IN", "A");
    expect(harness.rpcCalls).toHaveLength(1);
    utils.unmount();
    await act(async () => {
      harness.rpcCalls[0].resolve({ data: [makeRow("A")], error: null });
      await flushMicro();
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("cannot commit a stale first-account success after a rapid round trip back to that id", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    emit("SIGNED_IN", "B");
    emit("SIGNED_OUT", null);
    emit("SIGNED_IN", "A");
    const generations = [...new Set(snapshots.map((s) => s.generation))];
    expect(generations).toEqual([0, 1, 2, 3, 4]);
    await resolveRpc(0, [makeRow("A")], null);
    expectState("loading", "A", 4);
  });

  it("cannot commit a stale first-account failure after a rapid round trip back to that id", async () => {
    mount(null);
    emit("SIGNED_IN", "A");
    emit("SIGNED_IN", "B");
    emit("SIGNED_OUT", null);
    emit("SIGNED_IN", "A");
    await rejectRpc(0, new Error("first A failed"));
    expectState("loading", "A", 4);
  });

  it("keeps the context value referentially stable across an unrelated rerender", () => {
    const utils = mount(null);
    const before = lastSnapshot();
    rerenderWith(utils, null);
    expect(lastSnapshot()).toBe(before);
  });
});
