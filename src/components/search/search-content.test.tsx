import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SearchContent } from "./search-content";

// --- Deferred, signal-aware supabase builder harness -------------------------
// Replaces the old chainable Proxy, which hardcoded `error: null` and could
// neither defer, reject, nor capture the abort signal.

type Payload = { data: unknown; error: { message?: string } | null };
type FilterRecord = { method: string; args: unknown[] };
type BuilderCall = {
  table: string;
  signal: AbortSignal | null;
  filters: FilterRecord[];
  resolve: (v: Payload) => void;
  reject: (e: unknown) => void;
  settled: boolean;
};

const harness = vi.hoisted(() => {
  const calls: BuilderCall[] = [];
  const autoPayloads = new Map<string, Payload>();

  function makeBuilder(table: string) {
    let resolveFn!: (v: Payload) => void;
    let rejectFn!: (e: unknown) => void;
    const promise = new Promise<Payload>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });
    const call: BuilderCall = {
      table,
      signal: null,
      filters: [],
      resolve: (v) => {
        call.settled = true;
        resolveFn(v);
      },
      reject: (e) => {
        call.settled = true;
        rejectFn(e);
      },
      settled: false,
    };
    calls.push(call);

    const builder = {
      select: (...args: unknown[]) => {
        call.filters.push({ method: "select", args });
        return builder;
      },
      ilike: (...args: unknown[]) => {
        call.filters.push({ method: "ilike", args });
        return builder;
      },
      or: (...args: unknown[]) => {
        call.filters.push({ method: "or", args });
        return builder;
      },
      eq: (...args: unknown[]) => {
        call.filters.push({ method: "eq", args });
        return builder;
      },
      in: (...args: unknown[]) => {
        call.filters.push({ method: "in", args });
        return builder;
      },
      neq: (...args: unknown[]) => {
        call.filters.push({ method: "neq", args });
        return builder;
      },
      order: (...args: unknown[]) => {
        call.filters.push({ method: "order", args });
        return builder;
      },
      limit: (...args: unknown[]) => {
        call.filters.push({ method: "limit", args });
        return builder;
      },
      abortSignal: (sig: AbortSignal) => {
        call.signal = sig;
        return builder;
      },
      then: promise.then.bind(promise),
    };

    const auto = autoPayloads.get(table);
    if (auto) call.resolve(auto);

    return builder;
  }

  return { calls, autoPayloads, makeBuilder };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: (table: string) => harness.makeBuilder(table) }),
}));

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
}));

// --- Harness helpers ---------------------------------------------------------

function resetHarness() {
  harness.calls.length = 0;
  harness.autoPayloads.clear();
}

function callsFor(table: string) {
  return harness.calls.filter((c) => c.table === table);
}

function pendingFor(table: string) {
  return harness.calls.filter((c) => c.table === table && !c.settled);
}

function resolveNext(table: string, payload: Payload): BuilderCall | undefined {
  const call = pendingFor(table)[0];
  if (call) call.resolve(payload);
  return call;
}

function rejectNext(table: string, err: unknown): BuilderCall | undefined {
  const call = pendingFor(table)[0];
  if (call) call.reject(err);
  return call;
}

function allSignals(): AbortSignal[] {
  return harness.calls
    .map((c) => c.signal)
    .filter((s): s is AbortSignal => s !== null);
}

function autoSetup(
  payloads: Record<string, unknown[] | { error: { message?: string } }>,
) {
  for (const [table, value] of Object.entries(payloads)) {
    if (Array.isArray(value)) {
      harness.autoPayloads.set(table, { data: value, error: null });
    } else {
      harness.autoPayloads.set(table, { data: null, error: value.error });
    }
  }
}

// --- Auth snapshot helpers ---------------------------------------------------

function authed(userId: string, generation = 0) {
  return {
    status: "authenticated" as const,
    userId,
    generation,
    user: { id: userId },
  };
}
function loadingSnap(userId: string | null, generation = 0) {
  return { status: "loading" as const, userId, generation, user: null };
}
function unauthed(generation = 0) {
  return { status: "unauthenticated" as const, userId: null, generation, user: null };
}
function erroredSnap(userId: string, generation = 0) {
  return { status: "error" as const, userId, generation, user: null };
}

// --- Common fixtures ---------------------------------------------------------

const PLACEHOLDER = "Buscar grupos, contas, pessoas...";
const GROUPS = [{ id: "g1", name: "Amigos da facul" }];
const EXPENSES = [
  {
    id: "e1",
    title: "Churrasco",
    merchant_name: null,
    total_amount: 15000,
    status: "active",
    group_id: "g1",
  },
];
const PEOPLE = [
  { id: "u2", handle: "joao", name: "João Silva", avatar_url: null },
];
const MEMBERS = [{ group_id: "g1" }, { group_id: "g1" }];

function inputEl() {
  return screen.getByPlaceholderText(PLACEHOLDER);
}

function setQuery(value: string) {
  fireEvent.change(inputEl(), { target: { value } });
}

/** Drain the microtask queue so execute() continuations settle between steps. */
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** Resolve the four primaries (FIFO) in declaration order. */
function resolvePrimaries(overrides: Partial<{
  groups: Payload;
  expenses: Payload;
  user_profiles: Payload;
  balances: Payload;
}> = {}) {
  resolveNext("groups", overrides.groups ?? { data: GROUPS, error: null });
  resolveNext(
    "expenses",
    overrides.expenses ?? { data: EXPENSES, error: null },
  );
  resolveNext(
    "user_profiles",
    overrides.user_profiles ?? { data: PEOPLE, error: null },
  );
  resolveNext("balances", overrides.balances ?? { data: [], error: null });
}

beforeEach(() => {
  resetHarness();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue(authed("a"));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe("SearchContent identity binding (#479)", () => {
  it("1. short query after success: rows removed, prior signal aborted, no new request", async () => {
    autoSetup({
      groups: GROUPS,
      expenses: [],
      user_profiles: [],
      balances: [],
      group_members: MEMBERS,
    });
    render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(400);
    await waitFor(() =>
      expect(screen.getByText("Amigos da facul")).toBeInTheDocument(),
    );

    const callsBeforeShort = harness.calls.length;
    const signalsBefore = allSignals();
    expect(signalsBefore.length).toBeGreaterThan(0);
    // Every prior signal still alive (success does not abort).
    expect(signalsBefore.every((s) => !s.aborted)).toBe(true);

    // Collapse to a sub-2-char query: the keyed child remounts to idle and the
    // previous attempt unmounts (aborting its signal).
    setQuery("a");
    await flush();

    expect(screen.queryByText("Amigos da facul")).not.toBeInTheDocument();
    expect(harness.calls.length).toBe(callsBeforeShort);
    expect(signalsBefore.every((s) => s.aborted)).toBe(true);
  });

  it("2. debounce boundary: 299ms -> zero calls; +1ms -> exactly four primaries", async () => {
    autoSetup({
      groups: [],
      expenses: [],
      user_profiles: [],
      balances: [],
    });
    render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(299);
    expect(harness.calls.length).toBe(0);

    vi.advanceTimersByTime(1);
    expect(harness.calls.length).toBe(4);
    expect(
      ["groups", "expenses", "user_profiles", "balances"].every((t) =>
        callsFor(t).length === 1,
      ),
    ).toBe(true);
  });

  it("3. q1 -> q2 after success and mid-flight: old rows gone, old signal aborted, late q1 changes nothing", async () => {
    autoSetup({
      groups: GROUPS,
      expenses: [],
      user_profiles: [],
      balances: [],
      group_members: MEMBERS,
    });
    render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(400);
    await waitFor(() =>
      expect(screen.getByText("Amigos da facul")).toBeInTheDocument(),
    );

    // Switch to a new revision while keeping q1's request pending (override
    // auto-resolve by clearing it so q2's primaries stay deferred).
    harness.autoPayloads.clear();
    setQuery("bru");
    await flush();

    // q1 attempt unmounted -> its signals aborted.
    const q1Signals = harness.calls
      .slice(0, 4)
      .map((c) => c.signal)
      .filter((s): s is AbortSignal => s !== null);
    expect(q1Signals.every((s) => s.aborted)).toBe(true);
    // Old rows gone in the boundary render.
    expect(screen.queryByText("Amigos da facul")).not.toBeInTheDocument();

    const callsBefore = harness.calls.length;
    // Late fulfilment of q1's primaries must not paint anything.
    resolveNext("groups", { data: GROUPS, error: null });
    resolveNext("expenses", { data: [], error: null });
    resolveNext("user_profiles", { data: [], error: null });
    resolveNext("balances", { data: [], error: null });
    await flush();
    expect(screen.queryByText("Amigos da facul")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // q2 issued its own four primaries (debounced 300ms not yet elapsed here).
    expect(harness.calls.length).toBe(callsBefore);
  });

  it("4. \"ana\" -> \"ana \": revision bump aborts and re-debounces despite equal normalizedQuery", async () => {
    autoSetup({
      groups: GROUPS,
      expenses: [],
      user_profiles: [],
      balances: [],
      group_members: MEMBERS,
    });
    render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(400);
    await waitFor(() =>
      expect(screen.getByText("Amigos da facul")).toBeInTheDocument(),
    );

    const callsBefore = harness.calls.length;
    const signalsBefore = allSignals();

    // Append a space: normalizedQuery unchanged ("ana"), but revision bumps.
    setQuery("ana ");
    await flush();

    expect(signalsBefore.every((s) => s.aborted)).toBe(true);
    // A fresh attempt-0 debounce was scheduled: one new round of primaries only
    // after the timer elapses.
    expect(harness.calls.length).toBe(callsBefore);
    vi.advanceTimersByTime(299);
    expect(harness.calls.length).toBe(callsBefore);
    vi.advanceTimersByTime(1);
    expect(harness.calls.length).toBe(callsBefore + 4);
  });

  it.each([
    ["loading with null userId", loadingSnap(null)],
    ["loading with userId a", loadingSnap("a")],
    ["unauthenticated", unauthed()],
    ["error with userId a", erroredSnap("a")],
  ])(
    "5. after an A success, %s hides the textbox/results and aborts the signal",
    async (_label, snapshot) => {
      autoSetup({
        groups: GROUPS,
        expenses: [],
        user_profiles: [],
        balances: [],
        group_members: MEMBERS,
      });
      const { rerender } = render(<SearchContent />);

      setQuery("ana");
      vi.advanceTimersByTime(400);
      await waitFor(() =>
        expect(screen.getByText("Amigos da facul")).toBeInTheDocument(),
      );

      const callsBefore = harness.calls.length;
      const signalsBefore = allSignals();

      useAuthMock.mockReturnValue(snapshot);
      rerender(<SearchContent />);

      expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
      expect(screen.queryByText("Amigos da facul")).not.toBeInTheDocument();
      expect(signalsBefore.every((s) => s.aborted)).toBe(true);
      expect(harness.calls.length).toBe(callsBefore);
    },
  );

  it("6. authenticated A/g -> A/g+1 same query: rows removed, signal aborted, fresh 299+1 debounce", async () => {
    autoSetup({
      groups: GROUPS,
      expenses: [],
      user_profiles: [],
      balances: [],
      group_members: MEMBERS,
    });
    const { rerender } = render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(400);
    await waitFor(() =>
      expect(screen.getByText("Amigos da facul")).toBeInTheDocument(),
    );

    const callsBefore = harness.calls.length;
    const signalsBefore = allSignals();

    useAuthMock.mockReturnValue(authed("a", 1));
    rerender(<SearchContent />);

    expect(screen.queryByText("Amigos da facul")).not.toBeInTheDocument();
    expect(signalsBefore.every((s) => s.aborted)).toBe(true);

    vi.advanceTimersByTime(299);
    expect(harness.calls.length).toBe(callsBefore);
    vi.advanceTimersByTime(1);
    expect(harness.calls.length).toBe(callsBefore + 4);
  });

  it("7a. A -> B unchanged query: no A commit, one B attempt-0 request", async () => {
    autoSetup({
      groups: GROUPS,
      expenses: [],
      user_profiles: [],
      balances: [],
      group_members: MEMBERS,
    });
    const { rerender } = render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(400);
    await waitFor(() =>
      expect(screen.getByText("Amigos da facul")).toBeInTheDocument(),
    );

    const callsBefore = harness.calls.length;
    const signalsBefore = allSignals();

    useAuthMock.mockReturnValue(authed("b"));
    rerender(<SearchContent />);

    expect(signalsBefore.every((s) => s.aborted)).toBe(true);
    expect(screen.queryByText("Amigos da facul")).not.toBeInTheDocument();
    // B debounces: nothing until 300ms.
    expect(harness.calls.length).toBe(callsBefore);
    vi.advanceTimersByTime(300);
    expect(harness.calls.length).toBe(callsBefore + 4);
    // B's balances filter is scoped to B's id exactly.
    const bBalance = callsFor("balances")[callsFor("balances").length - 1];
    const orFilter = bBalance.filters.find((f) => f.method === "or");
    expect(String(orFilter?.args[0])).toBe("user_a.eq.b,user_b.eq.b");
  });

  it("7b. A -> B mid-flight: no A commit, one B attempt-0 request", async () => {
    autoSetup({
      groups: GROUPS,
      expenses: [],
      user_profiles: [],
      balances: [],
    });
    const { rerender } = render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(300);
    await flush();
    // A primaries in flight (auto-resolved, but secondaries pending). Switch.
    const callsAtSwitch = harness.calls.length;
    const signalsBefore = allSignals();

    useAuthMock.mockReturnValue(authed("b"));
    rerender(<SearchContent />);

    expect(signalsBefore.every((s) => s.aborted)).toBe(true);
    expect(screen.queryByText("Amigos da facul")).not.toBeInTheDocument();
    expect(harness.calls.length).toBe(callsAtSwitch);
    vi.advanceTimersByTime(300);
    // B's fresh four primaries.
    expect(harness.calls.length).toBe(callsAtSwitch + 4);
  });

  it("8. B projection: balance .or contains B's id, B absent from people, A is counterparty with inverted direction", async () => {
    // Under B, the balance row user_a=B flips so A is the counterparty and B
    // owes (direction "owes") — opposite of how it reads under A.
    const balanceRow = {
      group_id: "g1",
      user_a: "b",
      user_b: "a",
      amount_cents: 5000,
    };
    autoSetup({
      groups: [],
      expenses: [],
      user_profiles: [{ id: "a", handle: "ana", name: "Ana", avatar_url: null }],
      balances: [balanceRow],
    });
    useAuthMock.mockReturnValue(authed("b"));
    render(<SearchContent />);

    setQuery("zz");
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getByText("Ana")).toBeInTheDocument());

    const balCall = callsFor("balances")[0];
    const orFilter = balCall.filters.find((f) => f.method === "or");
    expect(String(orFilter?.args[0])).toBe("user_a.eq.b,user_b.eq.b");
    // B is excluded from the people list (self-exclusion); B never appears.
    expect(screen.queryByText("Bruno")).not.toBeInTheDocument();
    // A appears as counterparty; under B the direction is "owes" (R$ 50,00).
    expect(screen.getByText(/Você deve R\$\s*50,00/)).toBeInTheDocument();
  });

  it("9. failure -> Tentar de novo: old signal aborted, one new round with no timer advance, success renders", async () => {
    autoSetup({
      groups: { error: { message: "boom" } },
      expenses: [],
      user_profiles: [],
      balances: [],
    });
    render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(300);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(screen.getByText("Tentar de novo")).toBeInTheDocument();
    expect(screen.queryByText("Amigos da facul")).not.toBeInTheDocument();

    const callsAtFailure = harness.calls.length;
    const signalsAtFailure = allSignals();

    // Provide success data for the retry.
    autoSetup({
      groups: GROUPS,
      expenses: [],
      user_profiles: [],
      balances: [],
      group_members: MEMBERS,
    });
    fireEvent.click(screen.getByText("Tentar de novo"));
    // Retry is attempt > 0 -> execute runs immediately, no timer advance.
    expect(harness.calls.length).toBe(callsAtFailure + 4);

    expect(signalsAtFailure.every((s) => s.aborted)).toBe(true);
    await waitFor(() =>
      expect(screen.getByText("Amigos da facul")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("10. attempt>0 then loading/A/g and back: remounted attempt is 0 (299 zero, +1 one round)", async () => {
    autoSetup({
      groups: { error: { message: "boom" } },
      expenses: [],
      user_profiles: [],
      balances: [],
    });
    const { rerender } = render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const callsAtBoundary = harness.calls.length;
    const signalsAtBoundary = allSignals();

    // Detour through loading: textbox + results vanish, signal aborted.
    useAuthMock.mockReturnValue(loadingSnap("a"));
    rerender(<SearchContent />);
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
    expect(signalsAtBoundary.every((s) => s.aborted)).toBe(true);

    // Back to authenticated same identity: a fresh attempt-0 debounce.
    autoSetup({ groups: [], expenses: [], user_profiles: [], balances: [] });
    useAuthMock.mockReturnValue(authed("a"));
    rerender(<SearchContent />);

    vi.advanceTimersByTime(299);
    expect(harness.calls.length).toBe(callsAtBoundary);
    vi.advanceTimersByTime(1);
    expect(harness.calls.length).toBe(callsAtBoundary + 4);
  });

  it("11. A attempt>0 -> directly to B/g+1: no inherited bypass; B waits 299+1 ms", async () => {
    autoSetup({
      groups: { error: { message: "boom" } },
      expenses: [],
      user_profiles: [],
      balances: [],
    });
    const { rerender } = render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const callsAtBoundary = harness.calls.length;

    autoSetup({ groups: [], expenses: [], user_profiles: [], balances: [] });
    useAuthMock.mockReturnValue(authed("b", 1));
    rerender(<SearchContent />);

    vi.advanceTimersByTime(299);
    expect(harness.calls.length).toBe(callsAtBoundary);
    vi.advanceTimersByTime(1);
    expect(harness.calls.length).toBe(callsAtBoundary + 4);
  });

  it.each([
    ["groups", "groups"],
    ["expenses", "expenses"],
    ["user_profiles", "user_profiles"],
    ["balances", "balances"],
    ["group_members", "group_members"],
  ])(
    "12. {%s} error -> generic alert, no partial sections, no no-match",
    async (_label, table) => {
      const full: Record<string, unknown[] | { error: { message?: string } }> = {
        groups: GROUPS,
        expenses: [],
        user_profiles: PEOPLE,
        balances: [],
        group_members: MEMBERS,
      };
      full[table] = { error: { message: "db-down" } };
      // For the label-groups case we drive it via the dedicated case below; here
      // keep group_members fetchable only when groups resolve.
      autoSetup(full);
      render(<SearchContent />);

      setQuery("ana");
      vi.advanceTimersByTime(300);
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

      expect(screen.getByText("Não foi possível buscar agora.")).toBeInTheDocument();
      expect(screen.queryByText("Grupos")).not.toBeInTheDocument();
      expect(screen.queryByText("Contas")).not.toBeInTheDocument();
      expect(screen.queryByText("Pessoas")).not.toBeInTheDocument();
      expect(screen.queryByText("Nenhum resultado")).not.toBeInTheDocument();
      // No backend text leaks.
      expect(screen.queryByText("db-down")).not.toBeInTheDocument();
    },
  );

  it("12b. label groups error -> generic alert", async () => {
    // Primary groups succeed (empty), expenses carry a group_id so the label
    // lookup is required, and the label groups call fails.
    autoSetup({
      expenses: [
        { id: "e1", title: "X", merchant_name: null, total_amount: 1, status: "active", group_id: "gx" },
      ],
      user_profiles: [],
      balances: [],
    });
    render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(300);
    // Primary groups empty -> no group_members. Resolve primary groups empty.
    resolveNext("groups", { data: [], error: null });
    await flush();
    // Label groups call now pending; fail it.
    resolveNext("groups", { data: null, error: { message: "label-down" } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("X")).not.toBeInTheDocument();
  });

  it.each([
    ["primary", () => {
      resolveNext("groups", { data: null, error: null });
      resolveNext("expenses", { data: [], error: null });
      resolveNext("user_profiles", { data: [], error: null });
      resolveNext("balances", { data: [], error: null });
    }],
    ["group_members", () => {
      resolveNext("groups", { data: GROUPS, error: null });
      resolveNext("expenses", { data: [], error: null });
      resolveNext("user_profiles", { data: [], error: null });
      resolveNext("balances", { data: [], error: null });
    }],
    ["label groups", () => {
      resolveNext("groups", { data: [], error: null });
      resolveNext("expenses", { data: [{ id: "e1", title: "X", merchant_name: null, total_amount: 1, status: "active", group_id: "gx" }], error: null });
      resolveNext("user_profiles", { data: [], error: null });
      resolveNext("balances", { data: [], error: null });
    }],
  ])(
    "13. {data:null,error:null} for %s -> failure",
    async (_label, resolve) => {
      render(<SearchContent />);
      setQuery("ana");
      vi.advanceTimersByTime(300);
      await flush();

      resolve();
      if (_label === "group_members") {
        await flush();
        resolveNext("group_members", { data: null, error: null });
      }
      if (_label === "label groups") {
        await flush();
        resolveNext("groups", { data: null, error: null });
      }
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    },
  );

  it.each([
    ["empty-for-nonempty", [{ id: "gx", name: "X" }], [{ id: "e1", title: "Y", merchant_name: null, total_amount: 1, status: "active", group_id: "gx" }, { id: "e2", title: "Z", merchant_name: null, total_amount: 1, status: "active", group_id: "gz" }], { id: "gx", name: "X" }, false],
    ["1-of-2 subset", [], [{ id: "e1", title: "Y", merchant_name: null, total_amount: 1, status: "active", group_id: "gx" }, { id: "e2", title: "Z", merchant_name: null, total_amount: 1, status: "active", group_id: "gz" }], { id: "gx", name: "X" }, false],
    ["duplicate id", [], [{ id: "e1", title: "Y", merchant_name: null, total_amount: 1, status: "active", group_id: "gx" }], { id: "gx", name: "X" }, false],
    ["complete plus unexpected", [], [{ id: "e1", title: "Y", merchant_name: null, total_amount: 1, status: "active", group_id: "gx" }], { id: "gx", name: "X", extra: true } as unknown as { id: string; name: string }, false],
    ["blank name", [], [{ id: "e1", title: "Y", merchant_name: null, total_amount: 1, status: "active", group_id: "gx" }], { id: "gx", name: "   " }, false],
    ["complete exact", [], [{ id: "e1", title: "Y", merchant_name: null, total_amount: 1, status: "active", group_id: "gx" }], { id: "gx", name: "X" }, true],
  ])(
    "14. label coverage %s -> renders expenses only on the complete exact case",
    async (_label, _groups, expenses, _labelRow, shouldRender) => {
      autoSetup({
        expenses,
        user_profiles: [],
        balances: [],
      });
      render(<SearchContent />);
      setQuery("ana");
      vi.advanceTimersByTime(300);
      // Primary groups empty (no group_members needed).
      resolveNext("groups", { data: [], error: null });
      await flush();

      const labelPayload = (() => {
        if (_label === "duplicate id") {
          return { data: [{ id: "gx", name: "X" }, { id: "gx", name: "X2" }], error: null };
        }
        if (_label === "complete plus unexpected") {
          return { data: [{ id: "gx", name: "X" }, { id: "gother", name: "Other" }], error: null };
        }
        if (_label === "1-of-2 subset") {
          return { data: [{ id: "gx", name: "X" }], error: null };
        }
        if (_label === "complete exact") {
          return { data: [{ id: "gx", name: "X" }], error: null };
        }
        if (_label === "blank name") {
          return { data: [{ id: "gx", name: "   " }], error: null };
        }
        // empty-for-nonempty: requested 2 (gx, gz), label has 1 (gx)
        return { data: [{ id: "gx", name: "X" }], error: null };
      })();
      resolveNext("groups", labelPayload);

      if (shouldRender) {
        await waitFor(() => expect(screen.getByText("Contas")).toBeInTheDocument());
        expect(screen.getByText("Y")).toBeInTheDocument();
      } else {
        await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
        expect(screen.queryByText("Contas")).not.toBeInTheDocument();
      }
    },
  );

  it("15. both secondaries in flight, superseded by q2: same signal captured, both aborted, late settlement cannot alter q2", async () => {
    // Primaries resolve manually so group_members and the label groups lookup
    // both stay pending and capture q1's shared signal.
    render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(300);
    resolvePrimaries({
      groups: { data: GROUPS, error: null },
      expenses: { data: EXPENSES, error: null },
    });
    await waitFor(() => expect(pendingFor("group_members").length).toBe(1));
    await waitFor(() => expect(pendingFor("groups").length).toBe(1));

    const membersSig = callsFor("group_members")[0].signal;
    const labelsSig = callsFor("groups")[1].signal;
    expect(membersSig).toBe(labelsSig);
    expect(membersSig?.aborted).toBe(false);

    setQuery("bru");
    await flush();

    expect(membersSig?.aborted).toBe(true);
    expect(labelsSig?.aborted).toBe(true);

    resolveNext("group_members", { data: MEMBERS, error: null });
    resolveNext("groups", { data: GROUPS, error: null });
    await flush();
    expect(screen.queryByText("Amigos da facul")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("16a. reject a primary while siblings are pending -> generic alert, shared signal aborted, no backend text", async () => {
    // groups stays pending (rejectable); the other primaries auto-resolve.
    autoSetup({ expenses: [], user_profiles: [], balances: [] });
    render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(pendingFor("groups").length).toBe(1));

    const groupsSig = callsFor("groups")[0].signal;
    rejectNext("groups", new Error("primary-down"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    expect(screen.getByText("Não foi possível buscar agora.")).toBeInTheDocument();
    expect(screen.queryByText("primary-down")).not.toBeInTheDocument();
    expect(groupsSig?.aborted).toBe(true);
  });

  it("16b. reject a secondary while a sibling is pending -> generic alert, shared signal aborted, no backend text", async () => {
    autoSetup({ groups: GROUPS, expenses: EXPENSES, user_profiles: [], balances: [] });
    // group_members stays pending (rejectable); the label groups auto-resolves.
    harness.autoPayloads.delete("group_members");
    render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(pendingFor("group_members").length).toBe(1));

    const membersSig = callsFor("group_members")[0].signal;
    rejectNext("group_members", new Error("secondary-down"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    expect(screen.getByText("Não foi possível buscar agora.")).toBeInTheDocument();
    expect(screen.queryByText("secondary-down")).not.toBeInTheDocument();
    expect(membersSig?.aborted).toBe(true);
  });

  it("17. reject stale q1 after q2 owns the UI -> no alert, no stale rows, no unhandled rejection", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (e: unknown) => rejections.push(e);
    process.on("unhandledRejection", onUnhandled);

    try {
      render(<SearchContent />);
      setQuery("ana");
      vi.advanceTimersByTime(300);
      await waitFor(() => expect(pendingFor("groups").length).toBe(1));

      // q2 takes over; q1's attempt unmounts (cancelled + aborted).
      setQuery("bru");
      await flush();
      const q1GroupsCall = harness.calls[0];
      expect(q1GroupsCall?.signal?.aborted).toBe(true);

      // Reject q1's stale, in-flight groups builder.
      q1GroupsCall?.reject(new Error("stale-q1"));
      await flush();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText("Amigos da facul")).not.toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(rejections.length).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("18. resolve an aborted builder with abort-shaped result -> no alert for the current owner", async () => {
    render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(pendingFor("groups").length).toBe(1));

    const q1GroupsCall = callsFor("groups")[0];
    expect(q1GroupsCall?.signal?.aborted).toBe(false);

    // q2 supersedes q1; q1's signal is aborted by the unmount cleanup.
    setQuery("bru");
    await flush();
    expect(q1GroupsCall?.signal?.aborted).toBe(true);

    // Late, abort-shaped resolution of q1's primaries: the post-await guard
    // (signal.aborted) swallows it before the error check, so no failure.
    resolveNext("groups", { data: null, error: { message: "AbortError" } });
    resolveNext("expenses", { data: [], error: null });
    resolveNext("user_profiles", { data: [], error: null });
    resolveNext("balances", { data: [], error: null });
    await flush();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Amigos da facul")).not.toBeInTheDocument();
  });

  it.each([
    ["during debounce", 0],
    ["during primaries", 1],
    ["during secondaries", 2],
  ])("19. unmount %s: no timer-driven call, all signals aborted, rejection contained", async (_label, phase) => {
    autoSetup({
      groups: GROUPS,
      expenses: EXPENSES,
      user_profiles: [],
      balances: [],
    });
    harness.autoPayloads.delete("group_members");
    const { unmount } = render(<SearchContent />);

    setQuery("ana");
    if (phase === 0) {
      // unmount before the timer fires
      const sigs = allSignals();
      unmount();
      vi.advanceTimersByTime(400);
      expect(harness.calls.length).toBe(0);
      expect(sigs.length).toBe(0); // no signal captured yet (timer never fired)
      return;
    }
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(harness.calls.length).toBe(4));
    const sigsAtPrimaries = allSignals();

    if (phase === 1) {
      unmount();
      // Arrange a rejection on a now-orphaned primary; must be contained.
      harness.calls[0].reject(new Error("unmount-primary"));
      vi.advanceTimersByTime(0);
      await new Promise((r) => setTimeout(r, 0));
      expect(sigsAtPrimaries.every((s) => s.aborted)).toBe(true);
      return;
    }
    // phase 2: wait for secondaries to be pending then unmount
    await waitFor(() => expect(pendingFor("group_members").length).toBe(1));
    const sigsAtSecondaries = allSignals();
    unmount();
    rejectNext("group_members", new Error("unmount-secondary"));
    await new Promise((r) => setTimeout(r, 0));
    expect(sigsAtSecondaries.every((s) => s.aborted)).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("20. happy path: all three sections project correctly; semantic no-match when all empty", async () => {
    // Success with data across groups, expenses (label via shared groups data),
    // and people with a balance.
    autoSetup({
      groups: GROUPS,
      expenses: EXPENSES,
      user_profiles: PEOPLE,
      balances: [
        { group_id: "g1", user_a: "a", user_b: "u2", amount_cents: 5000 },
      ],
      group_members: MEMBERS,
    });
    render(<SearchContent />);

    setQuery("ana");
    vi.advanceTimersByTime(400);
    await waitFor(() => expect(screen.getByText("Grupos")).toBeInTheDocument());

    // Groups section: the group card link (the expense card also carries the
    // shared group name, so anchor on the member-count text).
    const groupLink = screen.getByText(/3 membros/).closest("a");
    expect(groupLink).toHaveAttribute("href", "/app/groups/g1");
    // Expenses section: amount + group name resolved via label coverage.
    const expLink = screen.getByText("Churrasco").closest("a");
    expect(expLink).toHaveAttribute("href", "/app/bill/e1");
    expect(screen.getByText(/R\$\s*150,00/)).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    // People section with balance direction.
    expect(screen.getByText("@joao")).toBeInTheDocument();
    expect(screen.getByText(/Você deve/)).toBeInTheDocument();

    // Semantic no-match when every projection is empty and no label requested.
    resetHarness();
    autoSetup({
      groups: [],
      expenses: [],
      user_profiles: [],
      balances: [],
    });
    setQuery("zz");
    vi.advanceTimersByTime(400);
    await waitFor(() =>
      expect(screen.getByText("Nenhum resultado")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
