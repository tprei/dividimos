import { createClient } from "@/lib/supabase/client";
import { createLogger, logError } from "@/lib/logger";
import type {
  ActivateExpenseRequest,
  ActivateExpenseResult,
  ActivateExpenseBalanceUpdate,
} from "@/types";

const logger = createLogger("expense-rpc");

/**
 * Parses a Supabase RPC error message into a structured error code and detail.
 * RPC errors come as "ERROR_CODE: detail message".
 */
function parseRpcError(message: string): { code: string; detail: string } {
  const match = message.match(/^(\w+):\s*(.+)$/);
  if (match) {
    return { code: match[1], detail: match[2] };
  }
  return { code: "unknown", detail: message };
}

/**
 * Calls the activate_expense RPC to transition a draft expense to active
 * and atomically update the group balances table.
 *
 * The RPC validates:
 * - Caller is the expense creator
 * - Expense is in draft status
 * - Shares sum to total_amount
 * - Payers sum to total_amount
 *
 * On success, returns the activated expense ID, new status, and
 * the balance updates that were applied.
 */
export async function activateExpense(
  request: ActivateExpenseRequest,
): Promise<ActivateExpenseResult | { error: string; code: string }> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logError(logger, "User not authenticated", { operation: "activateExpense" });
    return { error: "Não autenticado", code: "not_authenticated" };
  }

  // Call the RPC (returns void on success, throws on error)
  const { error: rpcError } = await supabase.rpc("activate_expense", {
    p_expense_id: request.expense_id,
  });

  if (rpcError) {
    const parsed = parseRpcError(rpcError.message);
    logError(logger, "activate_expense RPC failed", {
      operation: "activateExpense",
      expenseId: request.expense_id,
      code: parsed.code,
      detail: parsed.detail,
    });
    return { error: parsed.detail, code: parsed.code };
  }

  // RPC succeeded — fetch the updated balances for the caller.
  // We need the expense's group_id to query balances.
  const { data: expense, error: expenseError } = await supabase
    .from("expenses")
    .select("group_id")
    .eq("id", request.expense_id)
    .single();

  if (expenseError || !expense) {
    // RPC succeeded but we can't fetch the result — non-fatal
    logger.warn(
      { expenseId: request.expense_id, error: expenseError?.message },
      "Expense activated but failed to fetch result details",
    );
    return {
      expenseId: request.expense_id,
      status: "active",
      updatedBalances: [],
    };
  }

  // Fetch all balances for this group to return the current state
  const { data: balances } = await supabase
    .from("balances")
    .select("group_id, user_a, user_b, amount_cents")
    .eq("group_id", expense.group_id);

  const updatedBalances: ActivateExpenseBalanceUpdate[] = (balances ?? []).map(
    (b) => ({
      groupId: b.group_id,
      userA: b.user_a,
      userB: b.user_b,
      newAmountCents: b.amount_cents,
      // We don't have the delta from the RPC, so we report the current balance.
      // Callers needing the delta should diff against their previous state.
      deltaCents: 0,
    }),
  );

  return {
    expenseId: request.expense_id,
    status: "active",
    updatedBalances,
  };
}
