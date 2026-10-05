import type { Database } from "@/types/database";
import { LedgerError } from "@/lib/sync/errors";

export type ReportReason = Database["public"]["Enums"]["report_reason"];

export const REPORT_REASON_LABELS = {
  assedio: "Assédio ou perseguição",
  discurso_de_odio: "Discurso de ódio",
  ameaca_ou_violencia: "Ameaça ou violência",
  conteudo_sexual: "Conteúdo sexual impróprio",
  golpe_ou_spam: "Golpe ou spam",
  outro: "Outro motivo",
} satisfies Record<ReportReason, string>;

export interface ReportInput {
  targetUserId: string;
  messageId: string | null;
  reason: ReportReason;
  details: string | null;
}

export interface ReportResult {
  reportId: string;
  delivered: true;
}

export interface ReportNotification {
  report_id: string;
  reason: ReportReason;
  details: string | null;
  message_snapshot: string | null;
  reporter_handle: string;
  target_handle: string;
  group_name: string | null;
}

export function isReportUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && Object.hasOwn(REPORT_REASON_LABELS, value);
}

export function parseReportInput(value: unknown): ReportInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LedgerError("invalid_argument");
  }
  const input = value as Record<string, unknown>;
  if (!isReportUuid(input.targetUserId) || !isReportReason(input.reason)) {
    throw new LedgerError("invalid_argument");
  }
  if (input.messageId != null && !isReportUuid(input.messageId)) {
    throw new LedgerError("invalid_argument");
  }
  if (input.details != null && typeof input.details !== "string") {
    throw new LedgerError("invalid_argument");
  }
  if (typeof input.details === "string" &&
      /[\p{Cc}]/u.test(input.details.replace(/[\n\t]/gu, ""))) {
    throw new LedgerError("invalid_argument");
  }
  const details = typeof input.details === "string" ? input.details.trim() : "";
  if (Array.from(details).length > 1000) throw new LedgerError("invalid_argument");
  return {
    targetUserId: input.targetUserId,
    messageId: typeof input.messageId === "string" ? input.messageId : null,
    reason: input.reason,
    details: details || null,
  };
}

function summaryLine(value: string, limit: number): string {
  const points = Array.from(value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " "));
  return points.length > limit ? `${points.slice(0, limit).join("")}…` : points.join("");
}

export function formatReportNotification(report: ReportNotification): string {
  return [
    `Denúncia Dividimos: ${report.report_id}`,
    `Motivo: ${REPORT_REASON_LABELS[report.reason]}`,
    `Quem denunciou: ${summaryLine(report.reporter_handle, 30)}`,
    `Pessoa denunciada: ${summaryLine(report.target_handle, 30)}`,
    `Grupo: ${report.group_name === null ? "Sem grupo disponível" : summaryLine(report.group_name, 80)}`,
    `Mensagem: ${report.message_snapshot === null ? "Sem texto disponível" : summaryLine(report.message_snapshot, 500)}`,
    `Detalhes: ${report.details === null ? "Não informados" : summaryLine(report.details, 300)}`,
    "Revisar no Supabase em até 24 horas.",
  ].join("\n");
}
