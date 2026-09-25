/**
 * A best-effort reading of a spoken bill while it is still being said, so the
 * voice screen can fill in its preview live. The parse route stays the only
 * authority: nothing here reaches the ledger, and a miss just leaves a field
 * blank until the real parse lands.
 */
export interface VoiceBillSketch {
  title: string | null;
  amountCents: number | null;
  /** Names heard after "com", in the order they were said. */
  people: string[];
  /** "dividido em 4" / "entre 4" / "4 pessoas". */
  headcount: number | null;
  /** "me" for "paguei eu"/"eu paguei", otherwise the name before "pagou". */
  payer: "me" | string | null;
}

export const EMPTY_VOICE_BILL_SKETCH: VoiceBillSketch = {
  title: null,
  amountCents: null,
  people: [],
  headcount: null,
  payer: null,
};

const MAX_PEOPLE = 4;
const MAX_TITLE_WORDS = 3;
const MAX_AMOUNT_CENTS = 99_999_999;

const NUMBER_RE = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/giu;
const HEADCOUNT_BEFORE_RE = /(?:\b(?:em|entre|pra|para|por)\s*)$/u;
const HEADCOUNT_AFTER_RE = /^\s*(?:pessoas?|partes?|vezes)\b/u;
const HEADCOUNT_RE = /(?:\b(?:dividid[oa]|rachad[oa]|divide|dividir|racha|rachar)\s+(?:em|entre|por|pra|para)\s+|\bentre\s+)(\d{1,2})\b|\b(\d{1,2})\s+pessoas\b/u;
const TITLE_STOP_RE = /\d|r\$|,|\.|(?:^|\s)(?:com|paguei|pagou|dividid[oa]|rachad[oa]|entre|pra|para|eu|reais?)(?:\s|$)/u;
const PLACE_RE = /\b(?:no|na)\s+(\p{L}+)/u;
const PEOPLE_RE = /\bcom\s+(?:[oa]s?\s+)?([\p{L}\s,]+?)(?=\s*(?:\d|r\$|,\s*\d|\.|$|\s(?:paguei|pagou|dividid[oa]|rachad[oa]|reais?|deu|foi|no|na)\b))/u;
const PAYER_ME_RE = /\b(?:paguei\s+eu|eu\s+paguei|paguei)\b/u;
const PAYER_NAME_RE = /\b(\p{L}+)\s+pagou\b/u;
const NOT_A_NAME: Record<string, true> = { eu: true, quem: true, que: true, ele: true, ela: true, você: true };

function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1);
}

function amountFrom(text: string): number | null {
  for (const match of text.matchAll(NUMBER_RE)) {
    const index = match.index ?? 0;
    const before = text.slice(0, index);
    const after = text.slice(index + match[0].length);
    const explicitMoney = match[0].startsWith("r$") || /^\s*(?:reais?|conto|contos|pila)\b/u.test(after);
    if (!explicitMoney && (HEADCOUNT_BEFORE_RE.test(before) || HEADCOUNT_AFTER_RE.test(after))) continue;
    const reais = Number(match[1].replaceAll(".", ""));
    const cents = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
    const total = reais * 100 + cents;
    if (total > 0 && total <= MAX_AMOUNT_CENTS) return total;
  }
  return null;
}

function titleFrom(text: string): string | null {
  const stop = text.search(TITLE_STOP_RE);
  const lead = (stop === -1 ? text : text.slice(0, stop)).trim();
  const words = lead.split(/\s+/u).filter((word) => /\p{L}/u.test(word));
  const leadsWithPayment = words[0] === "paguei" || words[0] === "eu";
  if (words.length > 0 && !leadsWithPayment) {
    return capitalize(words.slice(0, MAX_TITLE_WORDS).join(" "));
  }
  const place = PLACE_RE.exec(text);
  return place ? capitalize(place[1]) : null;
}

function peopleFrom(text: string): string[] {
  const match = PEOPLE_RE.exec(text);
  if (!match) return [];
  return match[1]
    .split(/\s*,\s*|\s+e\s+/u)
    .map((name) => name.trim())
    .filter((name) => name.length > 1 && !NOT_A_NAME[name])
    .slice(0, MAX_PEOPLE)
    .map((name) => name.split(/\s+/u).map(capitalize).join(" "));
}

function payerFrom(text: string): VoiceBillSketch["payer"] {
  if (PAYER_ME_RE.test(text)) return "me";
  const named = PAYER_NAME_RE.exec(text);
  if (named && !NOT_A_NAME[named[1]]) return capitalize(named[1]);
  return null;
}

export function sketchVoiceBill(spoken: string): VoiceBillSketch {
  const text = spoken.toLocaleLowerCase("pt-BR").replace(/\s+/gu, " ").trim();
  if (!text) return EMPTY_VOICE_BILL_SKETCH;
  const headcount = HEADCOUNT_RE.exec(text);
  return {
    title: titleFrom(text),
    amountCents: amountFrom(text),
    people: peopleFrom(text),
    headcount: headcount ? Number(headcount[1] ?? headcount[2]) : null,
    payer: payerFrom(text),
  };
}
