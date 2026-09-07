import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ValidationResult } from "@/lib/expense-money";
import type { WireIssue } from "@/types/ledger";
import { LedgerError, codeFromMessage } from "./errors";

let clientInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!clientInstance) {
    clientInstance = createBrowserClient(
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

export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
  decode: (raw: unknown) => ValidationResult<T, WireIssue>,
): Promise<T> {
  let result: { data: unknown; error: unknown };
  try {
    const res = await getSupabase().rpc(name, args);
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

export async function rpcVoid(
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  let result: { error: unknown };
  try {
    const res = await getSupabase().rpc(name, args);
    result = { error: res.error };
  } catch (caught) {
    throw normalizeError(caught);
  }

  if (result.error) {
    throw normalizeError(result.error);
  }
}

export async function notify(eventId: number | null): Promise<void> {
  if (eventId === null) return;
  try {
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId }),
      keepalive: true,
    });
  } catch {
    // Push delivery is best effort; the mutation already succeeded.
  }
}
