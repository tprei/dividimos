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

  function reset() {
    _queues.clear();
    _calls.length = 0;
    _user = null;
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

  const client = {
    from: (table: string) => {
      _calls.push({ table, method: "from", args: [table] });
      return makeChain(table);
    },
    auth: {
      getUser: async () => ({ data: { user: _user }, error: null }),
    },
  };

  return { client, onTable, findCalls, setUser, reset, calls: _calls };
}

export type MockSupabase = ReturnType<typeof createMockSupabase>;
