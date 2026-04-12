import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockNeq = vi.fn();
const mockOr = vi.fn();
const mockFrom = vi.fn();

function createChain() {
  const chain = {
    select: mockSelect,
    eq: mockEq,
    neq: mockNeq,
    or: mockOr,
  };
  for (const fn of Object.values(chain)) {
    fn.mockReturnValue(chain);
  }
  return chain;
}

const mockSupabase = { from: mockFrom };

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mockSupabase,
}));

import { getGroupDebts, findLargestDebtGroup } from "./cross-group-settlement";

const GROUP_A = "group-a";
const GROUP_B = "group-b";
const USER = "user-111";
const COUNTERPARTY = "user-222";

const groupRows = [
  { id: GROUP_A, name: "Viagem SP" },
  { id: GROUP_B, name: "Almoço" },
];

describe("getGroupDebts", () => {
  let chain: ReturnType<typeof createChain>;

  beforeEach(() => {
    vi.clearAllMocks();
    chain = createChain();
    mockFrom.mockReturnValue(chain);
  });

  it("returns debts user owes counterparty, sorted largest first", async () => {
    const balanceRows = [
      { group_id: GROUP_A, user_a: USER, user_b: COUNTERPARTY, amount_cents: 2500 },
      { group_id: GROUP_B, user_a: USER, user_b: COUNTERPARTY, amount_cents: 1250 },
    ];

    let callCount = 0;
    mockOr.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return { data: balanceRows, error: null };
      return chain;
    });
    chain.select.mockImplementation(() => {
      if (mockFrom.mock.calls.at(-1)?.[0] === "groups") {
        return { data: groupRows, error: null };
      }
      return chain;
    });

    mockFrom.mockImplementation((table: string) => {
      const c = createChain();
      if (table === "groups") {
        c.select.mockReturnValue({ data: groupRows, error: null });
      } else {
        c.or.mockReturnValue({ data: balanceRows, error: null });
      }
      return c;
    });

    const result = await getGroupDebts(USER, COUNTERPARTY);

    expect(result).toHaveLength(2);
    expect(result[0].groupId).toBe(GROUP_A);
    expect(result[0].amountCents).toBe(-2500);
    expect(result[0].groupName).toBe("Viagem SP");
    expect(result[1].groupId).toBe(GROUP_B);
    expect(result[1].amountCents).toBe(-1250);
  });

  it("returns positive amountCents when counterparty owes user", async () => {
    const balanceRows = [
      { group_id: GROUP_A, user_a: COUNTERPARTY, user_b: USER, amount_cents: 3000 },
    ];

    mockFrom.mockImplementation((table: string) => {
      const c = createChain();
      if (table === "groups") {
        c.select.mockReturnValue({ data: groupRows, error: null });
      } else {
        c.or.mockReturnValue({ data: balanceRows, error: null });
      }
      return c;
    });

    const result = await getGroupDebts(USER, COUNTERPARTY);

    expect(result).toHaveLength(1);
    expect(result[0].amountCents).toBe(3000);
  });

  it("excludes balances not involving counterparty", async () => {
    const balanceRows = [
      { group_id: GROUP_A, user_a: USER, user_b: "user-333", amount_cents: 5000 },
      { group_id: GROUP_B, user_a: USER, user_b: COUNTERPARTY, amount_cents: 1000 },
    ];

    mockFrom.mockImplementation((table: string) => {
      const c = createChain();
      if (table === "groups") {
        c.select.mockReturnValue({ data: groupRows, error: null });
      } else {
        c.or.mockReturnValue({ data: balanceRows, error: null });
      }
      return c;
    });

    const result = await getGroupDebts(USER, COUNTERPARTY);

    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe(GROUP_B);
  });

  it("returns empty array when no shared debts", async () => {
    mockFrom.mockImplementation((table: string) => {
      const c = createChain();
      if (table === "groups") {
        c.select.mockReturnValue({ data: groupRows, error: null });
      } else {
        c.or.mockReturnValue({ data: [], error: null });
      }
      return c;
    });

    const result = await getGroupDebts(USER, COUNTERPARTY);
    expect(result).toHaveLength(0);
  });

  it("throws when balances query fails", async () => {
    mockFrom.mockImplementation((table: string) => {
      const c = createChain();
      if (table === "groups") {
        c.select.mockReturnValue({ data: groupRows, error: null });
      } else {
        c.or.mockReturnValue({ data: null, error: { message: "DB error" } });
      }
      return c;
    });

    await expect(getGroupDebts(USER, COUNTERPARTY)).rejects.toThrow(
      "Failed to query balances: DB error",
    );
  });

  it("falls back to group ID when group name not found", async () => {
    const balanceRows = [
      { group_id: "unknown-group", user_a: USER, user_b: COUNTERPARTY, amount_cents: 500 },
    ];

    mockFrom.mockImplementation((table: string) => {
      const c = createChain();
      if (table === "groups") {
        c.select.mockReturnValue({ data: [], error: null });
      } else {
        c.or.mockReturnValue({ data: balanceRows, error: null });
      }
      return c;
    });

    const result = await getGroupDebts(USER, COUNTERPARTY);
    expect(result[0].groupName).toBe("unknown-group");
  });
});

describe("findLargestDebtGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the group with the largest absolute debt", async () => {
    const balanceRows = [
      { group_id: GROUP_A, user_a: USER, user_b: COUNTERPARTY, amount_cents: 2500 },
      { group_id: GROUP_B, user_a: USER, user_b: COUNTERPARTY, amount_cents: 1250 },
    ];

    mockFrom.mockImplementation((table: string) => {
      const c = createChain();
      if (table === "groups") {
        c.select.mockReturnValue({ data: groupRows, error: null });
      } else {
        c.or.mockReturnValue({ data: balanceRows, error: null });
      }
      return c;
    });

    const result = await findLargestDebtGroup(USER, COUNTERPARTY);

    expect(result).toEqual({ groupId: GROUP_A, amountCents: -2500 });
  });

  it("returns null when no debts exist", async () => {
    mockFrom.mockImplementation((table: string) => {
      const c = createChain();
      if (table === "groups") {
        c.select.mockReturnValue({ data: [], error: null });
      } else {
        c.or.mockReturnValue({ data: [], error: null });
      }
      return c;
    });

    const result = await findLargestDebtGroup(USER, COUNTERPARTY);
    expect(result).toBeNull();
  });
});
