/**
 * Mock Supabase client for integration tests.
 *
 * Provides a chainable proxy that mimics the Supabase query builder.
 * Responses are queued per-table: each `from(table)` chain that is
 * awaited dequeues the next response for that table.
 *
 * Usage:
 *   const mock = createMockSupabase();
 *   mock.setUser({ id: "user-1" });
 *   mock.onTable("bills", { data: { id: "bill-1" }, error: null });
 *   // ... call function under test
 *   expect(mock.findCalls("bills", "insert")).toHaveLength(1);
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface MockResponse {
  data: unknown;
  error: unknown;
}

export interface ChainCall {
  table: string;
  method: string;
  args: unknown[];
}

export function createMockSupabase() {
  const _queues = new Map<string, MockResponse[]>();
  const _calls: ChainCall[] = [];
  let _user: Record<string, unknown> | null = null;
  let _claimsError: unknown = null;
  let _claimsThrow: unknown = null;
  let _claimsData: Record<string, unknown> | null = null;
  let _claimsDataSet = false;
  let _rpcThrow: { name: string; error: unknown } | null = null;

  /** Queue a response for the next awaited query on `table`. */
  function onTable(table: string, response: Partial<MockResponse> = {}) {
    if (!_queues.has(table)) _queues.set(table, []);
    _queues.get(table)!.push({ data: null, error: null, ...response });
  }

  function dequeue(table: string): MockResponse {
    const queue = _queues.get(table);
    if (!queue || queue.length === 0) return { data: null, error: null };
    return queue.shift()!;
  }

  /** Return all recorded calls, optionally filtered by table and method. */
  function findCalls(table: string, method?: string): ChainCall[] {
    return _calls.filter(
      (c) => c.table === table && (!method || c.method === method),
    );
  }

  function setUser(user: Record<string, unknown>) {
    _user = user;
  }

  /** Force `auth.getClaims()` to fail (e.g. network errors) until reset. */
  function setClaimsError(error: unknown) {
    _claimsError = error;
  }

  /** Force `auth.getClaims()` to reject until reset. */
  function setClaimsThrow(error: unknown) {
    _claimsThrow = error;
  }

  /** Force raw claims data (e.g. a malformed subject) for `auth.getClaims()`. */
  function setClaimsData(data: Record<string, unknown> | null) {
    _claimsData = data;
    _claimsDataSet = true;
  }

  /** Force the next `rpc(name)` call to reject instead of resolving. */
  function setRpcThrow(name: string, error: unknown) {
    _rpcThrow = { name, error };
  }

  function reset() {
    _queues.clear();
    _calls.length = 0;
    _user = null;
    _claimsError = null;
    _claimsThrow = null;
    _claimsData = null;
    _rpcThrow = null;
    _claimsDataSet = false;
  }

  /**
   * Build a chainable proxy for a given table.
   * Every method call (select, eq, insert, …) records itself and
   * returns a fresh proxy. Awaiting the proxy dequeues the next
   * response for that table.
   */
  function makeChain(table: string): unknown {
    return new Proxy(Object.create(null), {
      get(_, prop: string) {
        // Make the proxy thenable — this is where the response is consumed.
        if (prop === "then") {
          const resp = dequeue(table);
          return (
            onFulfilled: (v: unknown) => unknown,
            onRejected?: (v: unknown) => unknown,
          ) => Promise.resolve(resp).then(onFulfilled, onRejected);
        }
        if (prop === "catch") {
          const resp = dequeue(table);
          return (onRejected: (v: unknown) => unknown) =>
            Promise.resolve(resp).catch(onRejected);
        }
        if (prop === "finally") {
          const resp = dequeue(table);
          return (onFinally: () => void) =>
            Promise.resolve(resp).finally(onFinally);
        }
        // Every other access returns a function that records the call
        // and returns a new chainable proxy.
        return (...args: unknown[]) => {
          _calls.push({ table, method: prop, args });
          return makeChain(table);
        };
      },
    });
  }

  function onRpc(name: string, response: Partial<MockResponse> = {}) {
    onTable(`rpc:${name}`, response);
  }

  const client = {
    from: (table: string) => {
      _calls.push({ table, method: "from", args: [table] });
      return makeChain(table);
    },
    rpc: (name: string, args?: unknown) => {
      const key = `rpc:${name}`;
      _calls.push({ table: key, method: "rpc", args: [name, args] });
      if (_rpcThrow !== null && _rpcThrow.name === name) {
        const { error } = _rpcThrow;
        _rpcThrow = null;
        return Promise.reject(error);
      }
      return makeChain(key);
    },
    auth: {
      getUser: async () => ({ data: { user: _user }, error: null }),
      getClaims: async () => {
        if (_claimsThrow !== null) throw _claimsThrow;
        if (_claimsDataSet || _user === null) {
          return { data: _claimsData, error: _claimsError };
        }
        return {
          data: { claims: { ..._user, sub: _user.id } },
          error: _claimsError,
        };
      },
    },
  } as unknown as SupabaseClient;

  return {
    client,
    onTable,
    onRpc,
    findCalls,
    setUser,
    setClaimsError,
    setClaimsThrow,
    setClaimsData,
    setRpcThrow,
    reset,
    calls: _calls,
  };
}

export type MockSupabase = ReturnType<typeof createMockSupabase>;
