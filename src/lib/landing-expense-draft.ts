import { formatBRL } from "@/lib/currency";
import { MAX_EXPENSE_CENTS } from "@/lib/expense-money";

export interface DemoExpenseDraft {
  title: string;
  cents: number;
  people: number;
  names: string[];
}

const PEOPLE_COUNT_RE = /\b(?:dividid[oa]\s+)?(?:em|entre|pra|para)\s+(\d{1,2})\b(?!\s*(?:reais|real|,))/;
const PEOPLE_NOUN_RE = /\b(\d{1,2})\s+(?:pessoas|amigos|amigas)\b/;
const AMOUNT_RE = /(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?(?!\d)/;
const TRAILING_PREPOSITION_RE = /\b(?:de|do|da|no|na|um|uma)\s*$/;
const COMPANIONS_RE = /\bcom\s+(.+)$/;
const MAX_NAME_LENGTH = 16;
const MAX_PEOPLE = 20;

function parseCompanions(text: string): string[] {
  const match = text.match(COMPANIONS_RE);
  if (!match) return [];
  return match[1]
    .split(/,|\s+e\s+/)
    .map((name) =>
      name
        .replace(/^\s*(?:a|o|as|os)\s+/, "")
        .replace(/[.!?"”]/g, "")
        .trim(),
    )
    .filter((name) => name.length > 0 && name.length <= MAX_NAME_LENGTH && !/\d/.test(name));
}

export function parseDemoExpense(text: string): DemoExpenseDraft | null {
  let source = ` ${text.toLowerCase().replace(/r\$\s*/g, "")} `;
  let people: number | null = null;
  const countMatch = source.match(PEOPLE_COUNT_RE) ?? source.match(PEOPLE_NOUN_RE);
  if (countMatch?.index !== undefined) {
    people = Number.parseInt(countMatch[1], 10);
    source = `${source.slice(0, countMatch.index)} ${source.slice(countMatch.index + countMatch[0].length)}`;
  }

  const amountMatch = source.match(AMOUNT_RE);
  if (!amountMatch || amountMatch.index === undefined) return null;
  const reais = Number.parseInt(amountMatch[1].replace(/\./g, ""), 10);
  const fraction = amountMatch[2] ? Number.parseInt(amountMatch[2].padEnd(2, "0"), 10) : 0;
  const cents = reais * 100 + fraction;
  if (cents === 0 || cents > MAX_EXPENSE_CENTS) return null;

  const title = source.slice(0, amountMatch.index).replace(TRAILING_PREPOSITION_RE, "");
  const names = parseCompanions(source.slice(amountMatch.index + amountMatch[0].length));
  const counted = people ?? names.length + 1;

  return {
    title: title.trim().replace(/\s+/g, " ").replace(/^./, (first) => first.toUpperCase()) || "Despesa",
    cents,
    people: Math.min(Math.max(counted, 1), MAX_PEOPLE),
    names,
  };
}

export function describeDemoSplit(draft: DemoExpenseDraft): string {
  if (draft.people === 1) return "Só você";
  const each = Math.floor(draft.cents / draft.people);
  const remainder = draft.cents % draft.people;
  const share = remainder === 0 ? formatBRL(each) : `${formatBRL(each)} a ${formatBRL(each + 1)}`;
  return `${draft.people} pessoas · ${share} cada`;
}
