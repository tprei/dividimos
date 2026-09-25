/**
 * Fluid split editing: one person's share changes and the others follow so
 * the shares always add up to the total.
 *
 * Units are integers the caller chooses: basis points for percentages
 * (total 10_000) or centavos for amounts (total = the bill total). Shares
 * never become fractional; an uneven remainder goes to the earliest people
 * in order, one unit each (largest remainder with equal weights).
 */
export interface SplitBalance {
  readonly total: number;
  readonly ids: readonly string[];
  readonly shares: Readonly<Record<string, number>>;
  /** People whose share the user typed, least recently set first. */
  readonly setByUser: readonly string[];
}

function spreadEvenly(amount: number, ids: readonly string[], into: Record<string, number>): void {
  if (ids.length === 0) return;
  const base = Math.floor(amount / ids.length);
  const extra = amount - base * ids.length;
  ids.forEach((id, index) => {
    into[id] = base + (index < extra ? 1 : 0);
  });
}

/**
 * Takes `excess` units back from the user-set people other than `anchorId`,
 * least recently set first, never below zero. Returns what is still owed.
 */
function takeBack(
  excess: number,
  setByUser: readonly string[],
  anchorId: string | null,
  shares: Record<string, number>,
): number {
  let owed = excess;
  for (const id of setByUser) {
    if (owed === 0) break;
    if (id === anchorId) continue;
    const taken = Math.min(shares[id], owed);
    shares[id] -= taken;
    owed -= taken;
  }
  return owed;
}

function settle(
  total: number,
  ids: readonly string[],
  userShares: Readonly<Record<string, number>>,
  setByUser: readonly string[],
  anchorId: string | null,
): SplitBalance {
  const shares: Record<string, number> = {};
  let userSum = 0;
  for (const id of setByUser) {
    shares[id] = userShares[id];
    userSum += userShares[id];
  }
  const free = ids.filter((id) => !setByUser.includes(id));
  const rest = total - userSum;

  if (rest < 0) {
    const owed = takeBack(-rest, setByUser, anchorId, shares);
    if (anchorId !== null) shares[anchorId] -= owed;
    spreadEvenly(0, free, shares);
  } else if (free.length > 0) {
    spreadEvenly(rest, free, shares);
  } else {
    const receiver = setByUser.find((id) => id !== anchorId) ?? anchorId;
    if (receiver !== null) shares[receiver] += rest;
  }

  return { total, ids, shares, setByUser };
}

/** Everyone gets the same share; nobody counts as set by the user. */
export function evenSplitBalance(total: number, ids: readonly string[]): SplitBalance {
  const shares: Record<string, number> = {};
  spreadEvenly(total, ids, shares);
  return { total, ids, shares, setByUser: [] };
}

/**
 * Reopens saved shares. An even split reopens as untouched so the first edit
 * spreads freely; any other exact split reopens as set by the user in the
 * given order. Shares that do not add up to the total reopen even.
 */
export function splitBalanceFromShares(
  total: number,
  ids: readonly string[],
  saved: Readonly<Record<string, number>>,
): SplitBalance {
  let sum = 0;
  for (const id of ids) {
    const share = saved[id];
    if (!Number.isInteger(share) || share < 0) return evenSplitBalance(total, ids);
    sum += share;
  }
  if (sum !== total) return evenSplitBalance(total, ids);
  const even = evenSplitBalance(total, ids);
  if (ids.every((id) => even.shares[id] === saved[id])) return even;
  const shares: Record<string, number> = {};
  for (const id of ids) shares[id] = saved[id];
  return { total, ids, shares, setByUser: [...ids] };
}

/**
 * The user sets one person's share. The value is clamped to 0..total; the
 * remainder spreads evenly over the people the user has not set; when
 * everyone else is set, the least recently set person absorbs it.
 */
export function setSplitShare(balance: SplitBalance, id: string, value: number): SplitBalance {
  if (!balance.ids.includes(id) || !Number.isInteger(value)) return balance;
  const clamped = Math.min(Math.max(value, 0), balance.total);
  const setByUser = [...balance.setByUser.filter((other) => other !== id), id];
  const userShares = { ...balance.shares, [id]: clamped };
  return settle(balance.total, balance.ids, userShares, setByUser, id);
}

/**
 * What `id` would gain by taking everything nobody else was given by hand:
 * the total minus the other user-set shares, less what `id` holds now. Zero
 * until someone else has been set, so an untouched even split offers nothing.
 */
export function completableShare(balance: SplitBalance, id: string): number {
  if (!balance.ids.includes(id)) return 0;
  let pinnedByOthers = 0;
  let anyPinned = false;
  for (const other of balance.setByUser) {
    if (other === id) continue;
    anyPinned = true;
    pinnedByOthers += balance.shares[other] ?? 0;
  }
  if (!anyPinned) return 0;
  return Math.max(0, balance.total - pinnedByOthers - (balance.shares[id] ?? 0));
}

/** `id` takes the whole remainder; the people nobody set drop to zero. */
export function completeSplitShare(balance: SplitBalance, id: string): SplitBalance {
  const extra = completableShare(balance, id);
  if (extra === 0) return balance;
  return setSplitShare(balance, id, (balance.shares[id] ?? 0) + extra);
}

/** People joined or left: the user's shares stay, the rest re-spreads. */
export function withSplitPeople(balance: SplitBalance, ids: readonly string[]): SplitBalance {
  const setByUser = balance.setByUser.filter((id) => ids.includes(id));
  return settle(balance.total, ids, balance.shares, setByUser, null);
}

/** The total changed: the user's shares stay while they fit, the rest re-spreads. */
export function withSplitTotal(balance: SplitBalance, total: number): SplitBalance {
  if (!Number.isInteger(total) || total < 0) return balance;
  return settle(total, balance.ids, balance.shares, balance.setByUser, null);
}

/** Total minus the sum of shares; zero whenever the balance came from this module. */
export function splitRemainder(balance: SplitBalance): number {
  let sum = 0;
  for (const id of balance.ids) sum += balance.shares[id] ?? 0;
  return balance.total - sum;
}
