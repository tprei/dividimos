import { formatBRL } from "@/lib/currency";
import type { ExpenseVersion } from "@/types/ledger";

export interface DescribeVersionOptions {
  authorName: string;
  nameOf: (userId: string) => string;
}

function formatNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export function describeVersion(
  version: ExpenseVersion,
  options: DescribeVersionOptions,
): string[] {
  const who = options.authorName;
  if (version.versionNo === 1) {
    return [`${who} criou a conta`];
  }

  const summary = version.changeSummary;
  const sentences: string[] = [];
  if (summary?.title) {
    sentences.push(
      `${who} mudou o nome de “${summary.title[0]}” para “${summary.title[1]}”`,
    );
  }
  if (summary?.totalCents) {
    sentences.push(
      `${who} mudou o total de ${formatBRL(summary.totalCents[0])} para ${formatBRL(summary.totalCents[1])}`,
    );
  }
  if (summary && summary.participantsAdded.length > 0) {
    const names = formatNames(summary.participantsAdded.map(options.nameOf));
    sentences.push(`${who} adicionou ${names}`);
  }
  if (summary && summary.participantsRemoved.length > 0) {
    const names = formatNames(summary.participantsRemoved.map(options.nameOf));
    sentences.push(`${who} removeu ${names}`);
  }
  if (summary?.payersChanged) {
    sentences.push(`${who} mudou quem pagou`);
  }
  if (sentences.length === 0) {
    sentences.push(`${who} editou a conta`);
  }
  return sentences;
}
