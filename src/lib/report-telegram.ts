import "server-only";
import { formatReportNotification, type ReportNotification } from "@/lib/reports";
import { LedgerError } from "@/lib/sync/errors";

export async function sendReportToTelegram(report: ReportNotification): Promise<void> {
  const token = process.env.ALERT_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ALERT_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error("[reports] delivery failed", { reportId: report.report_id, kind: "unconfigured" });
    throw new LedgerError("report_delivery_failed");
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatReportNotification(report),
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      console.error("[reports] delivery failed", {
        reportId: report.report_id,
        kind: `http_${response.status}`,
      });
      throw new LedgerError("report_delivery_failed");
    }
    if (typeof payload !== "object" || payload === null ||
        !("ok" in payload) || payload.ok !== true) {
      console.error("[reports] delivery failed", { reportId: report.report_id, kind: "not_ok" });
      throw new LedgerError("report_delivery_failed");
    }
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    const kind = error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "network";
    console.error("[reports] delivery failed", { reportId: report.report_id, kind });
    throw new LedgerError("report_delivery_failed");
  }
}
