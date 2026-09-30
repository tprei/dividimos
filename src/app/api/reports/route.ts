import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { parseReportInput } from "@/lib/reports";
import { sendReportToTelegram } from "@/lib/report-telegram";
import {
  codeFromMessage,
  LedgerError,
  ledgerErrorMessage,
  type LedgerErrorCode,
} from "@/lib/sync/errors";

function failure(code: LedgerErrorCode): Response {
  const status = code === "unauthenticated" ? 401
    : code === "not_a_member" || code === "account_deleted" ? 403
    : code === "message_not_found" || code === "user_not_found" || code === "report_not_found" ? 404
    : code === "invalid_argument" ? 400
    : code === "report_rate_limited" ? 429
    : code === "report_delivery_failed" || code === "report_rate_limit_unavailable" ? 503
    : 500;
  return NextResponse.json(
    { error: { code, message: ledgerErrorMessage(new LedgerError(code)) } },
    { status },
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const callerId = data?.claims.sub;
    if (error || typeof callerId !== "string" || callerId.length === 0) {
      return failure("unauthenticated");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure("invalid_argument");
    }
    const input = parseReportInput(body);
    try {
      await enforceRateLimit("reports.create", callerId);
    } catch (limitError) {
      return failure(limitError instanceof AppError && limitError.code === "RATE_LIMIT_EXCEEDED"
        ? "report_rate_limited"
        : "report_rate_limit_unavailable");
    }

    const admin = createAdminClient();
    const { data: report, error: reportError } = await admin.rpc("report_content", {
      p_reporter_id: callerId,
      p_target_user_id: input.targetUserId,
      p_reason: input.reason,
      ...(input.messageId === null ? {} : { p_message_id: input.messageId }),
      ...(input.details === null ? {} : { p_details: input.details }),
    }).single();
    if (reportError) {
      return failure(reportError.code === "22P02"
        ? "invalid_argument"
        : codeFromMessage(reportError.message));
    }
    if (!report) return failure("unknown");

    if (report.notified_at === null) {
      await sendReportToTelegram(report);
      try {
        const { error: receiptError } = await admin.rpc("mark_report_notified", {
          p_report_id: report.report_id,
        });
        if (receiptError) return failure("report_delivery_failed");
      } catch {
        return failure("report_delivery_failed");
      }
    }

    return NextResponse.json({ reportId: report.report_id, delivered: true });
  } catch (error) {
    if (!(error instanceof LedgerError)) {
      console.error("[reports] unhandled route error", {
        code: "unknown",
        kind: error instanceof Error ? error.name : typeof error,
      });
    }
    return failure(error instanceof LedgerError ? error.code : "unknown");
  }
}
