"use client";

import { createClient } from "@/lib/supabase/client";
import { createLogger, logError } from "@/lib/logger";

const logger = createLogger("dm-actions");

export interface GetOrCreateDmGroupResult {
  groupId: string;
}

export interface DmActionError {
  error: string;
  code: string;
}

function parseRpcError(message: string): { code: string; detail: string } {
  const match = message.match(/^(\w+):\s*(.+)$/);
  if (match) {
    return { code: match[1], detail: match[2] };
  }
  return { code: "unknown", detail: message };
}

/**
 * Gets or creates a DM group between the current user and another user.
 * The RPC atomically finds an existing DM group or creates a new one,
 * preventing duplicates via a unique constraint on canonical user pairs.
 */
export async function getOrCreateDmGroup(
  otherUserId: string,
): Promise<GetOrCreateDmGroupResult | DmActionError> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logError(logger, "User not authenticated", {
      operation: "getOrCreateDmGroup",
    });
    return { error: "Não autenticado", code: "not_authenticated" };
  }

  const { data, error: rpcError } = await supabase.rpc(
    "get_or_create_dm_group",
    { p_other_user_id: otherUserId },
  );

  if (rpcError) {
    const parsed = parseRpcError(rpcError.message);
    logError(logger, "get_or_create_dm_group RPC failed", {
      operation: "getOrCreateDmGroup",
      otherUserId,
      code: parsed.code,
      detail: parsed.detail,
    });
    return { error: parsed.detail, code: parsed.code };
  }

  return { groupId: data as string };
}
