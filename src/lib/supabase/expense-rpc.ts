import { createClient } from "@/lib/supabase/client";
import { createLogger, logError } from "@/lib/logger";
import {
  decodeExpenseActivationResult,
  type GraphRevision,
} from "@/lib/expense-money";
import type { ActivateExpenseRequest, ActivateExpenseResult } from "@/types";

const logger = createLogger("expense-rpc");

type ActivateSavedExpenseRpcResponse = Readonly<{
  data: unknown;
  error: Readonly<{ message: string; code?: string }> | null;
}>;

type ActivateSavedExpenseRpc = (
  name: "activate_saved_expense",
  args: Readonly<{
    p_expense_id: string;
    p_expected_graph_revision: GraphRevision;
  }>,
) => PromiseLike<ActivateSavedExpenseRpcResponse>;

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
 * Activation requires the graph revision that was observed when the draft was
 * last persisted. It is intentionally separate from the legacy request type
 * until its remaining callers migrate to the revisioned graph contract.
 */
export type RevisionedActivateExpenseRequest = ActivateExpenseRequest &
  Readonly<{
    expectedGraphRevision: GraphRevision;
  }>;

export type RevisionedActivateExpenseResult = ActivateExpenseResult &
  Readonly<{
    graphRevision: GraphRevision;
  }>;

export type ActivateExpenseError = Readonly<{
  error: string;
  code: string;
}>;

/**
 * Calls `activate_saved_expense` to atomically activate a current draft graph.
 *
 * The expected graph revision makes activation a compare-and-swap mutation.
 * A stale revision is normalized to a stable client conflict while preserving
 * the provider's parsed error detail for display and diagnostics.
 */
export async function activateExpense(
  request: RevisionedActivateExpenseRequest,
): Promise<RevisionedActivateExpenseResult | ActivateExpenseError> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logError(logger, "User not authenticated", { operation: "activateExpense" });
    return { error: "Não autenticado", code: "not_authenticated" };
  }

  const activateSavedExpenseRpc = supabase.rpc.bind(supabase) as unknown as ActivateSavedExpenseRpc;
  const { data, error: rpcError } = await activateSavedExpenseRpc(
    "activate_saved_expense",
    {
      p_expense_id: request.expense_id,
      p_expected_graph_revision: request.expectedGraphRevision,
    },
  );

  if (rpcError) {
    const parsed = parseRpcError(rpcError.message);
    logError(logger, "activate_saved_expense RPC failed", {
      operation: "activateExpense",
      expenseId: request.expense_id,
      code: rpcError.code ?? parsed.code,
      detail: parsed.detail,
    });
    if (rpcError.code === "PST08") {
      return { error: parsed.detail, code: "stale_graph_revision" };
    }
    return { error: parsed.detail, code: parsed.code };
  }

  const decoded = decodeExpenseActivationResult(data);
  if (!decoded.ok) {
    logError(logger, "activate_saved_expense returned an invalid result", {
      operation: "activateExpense",
      expenseId: request.expense_id,
      issue: decoded.issue,
    });
    return {
      error: "Resposta de ativação inválida",
      code: decoded.issue.code,
    };
  }

  return {
    ...decoded.value,
    updatedBalances: [],
  };
}
