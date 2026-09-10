import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ValidationResult } from "@/lib/expense-money";
import type { WireIssue } from "@/types/ledger";
import { LedgerError, codeFromMessage } from "./errors";

type Functions = Database["public"]["Functions"];

type FunctionArgs<Fn extends keyof Functions> = [Functions[Fn]["Args"]] extends [never]
  ? Record<string, never> | undefined
  : Functions[Fn]["Args"];

let clientInstance: SupabaseClient<Database> | null = null;

/**
 * Account epoch for in-flight sync work. Every consumer that can publish into
 * the store after an await captures this before its request and re-checks it
 * before publishing, so a response belonging to a replaced account or a torn
 * down root is dropped instead of overwriting current data. Runtime only:
 * never persisted.
 */
let authGeneration = 0;

export function getAuthGeneration(): number {
  return authGeneration;
}

export function advanceAuthGeneration(): number {
  authGeneration += 1;
  return authGeneration;
}

export function getSupabase(): SupabaseClient<Database> {
  if (!clientInstance) {
    clientInstance = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return clientInstance;
}

function normalizeError(error: unknown): LedgerError {
  if (typeof error === "object" && error !== null && "message" in error) {
    const rawMsg = error.message;
    const msg = typeof rawMsg === "string" ? rawMsg : "";
    return new LedgerError(codeFromMessage(msg), { cause: error });
  }
  return new LedgerError("unknown", { cause: error });
}

export async function rpc<
  T,
  Fn extends keyof Functions = keyof Functions,
>(
  name: Fn,
  args: FunctionArgs<Fn>,
  decode: (raw: unknown) => ValidationResult<T, WireIssue>,
): Promise<T> {
  let result: { data: unknown; error: unknown };
  try {
    const res = await getSupabase().rpc(name, args as never);
    result = { data: res.data, error: res.error };
  } catch (caught) {
    throw normalizeError(caught);
  }

  if (result.error) {
    throw normalizeError(result.error);
  }

  const decoded = decode(result.data);
  if (!decoded.ok) {
    throw new LedgerError("invalid_wire", { cause: decoded.issue });
  }

  return decoded.value;
}

export async function rpcVoid<
  Fn extends keyof Functions = keyof Functions,
>(
  name: Fn,
  args: FunctionArgs<Fn>,
): Promise<void> {
  let result: { error: unknown };
  try {
    const res = await getSupabase().rpc(name, args as never);
    result = { error: res.error };
  } catch (caught) {
    throw normalizeError(caught);
  }

  if (result.error) {
    throw normalizeError(result.error);
  }
}

