import { isReportUuid, parseReportInput, type ReportInput, type ReportResult } from "@/lib/reports";
import { codeFromMessage, LedgerError } from "@/lib/sync/errors";

export async function reportContent(input: ReportInput): Promise<ReportResult> {
  const payload = parseReportInput(input);
  let response: Response;
  try {
    response = await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new LedgerError("network", { cause });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new LedgerError("invalid_wire", { cause });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new LedgerError("invalid_wire");
  }
  if (!response.ok) {
    if ("error" in body && typeof body.error === "object" && body.error !== null &&
        "code" in body.error && typeof body.error.code === "string") {
      throw new LedgerError(codeFromMessage(body.error.code));
    }
    throw new LedgerError("invalid_wire");
  }
  if (!("reportId" in body) || !isReportUuid(body.reportId) ||
      !("delivered" in body) || body.delivered !== true) {
    throw new LedgerError("invalid_wire");
  }
  return { reportId: body.reportId, delivered: true };
}
