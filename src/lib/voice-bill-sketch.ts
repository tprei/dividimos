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
}

export const EMPTY_VOICE_BILL_SKETCH: VoiceBillSketch = {
  title: null,
  amountCents: null,
  people: [],
};

const MAX_PEOPLE = 4;
const MAX_TITLE_WORDS = 3;
const MAX_AMOUNT_CENTS = 99_999_999;

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  um: 1,
  dois: 2,
  tres: 3,
  três: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
  cento: 100,
  duzentos: 200,
  trezentos: 300,
  quatrocentos: 400,
  quinhentos: 500,
  seiscentos: 600,
  setecentos: 700,
  oitocentos: 800,
  novecentos: 900,
  mil: 1000,
};

const WORD_NUM_SRC = Object.keys(NUMBER_WORDS).join("|");

/** One spoken cardinal: "vinte e cinco", "cento e vinte", "dois mil e quinhentos". */
const WORD_NUM_RE = new RegExp(`\\b(?:${WORD_NUM_SRC})(?:\\s+(?:e\\s+)?(?:${WORD_NUM_SRC}))*\\b`, "giu");

const DIGIT_MONEY_RE = /(?:r\$\s*)?(\d+(?:[.,]\d+)*)/giu;

/** Counts ("dividido em 4", "3 pessoas") are never the amount. */
const COUNT_BEFORE_RE = /(?:\b(?:em|entre|pra|para|por)\s*)$/u;
const COUNT_AFTER_RE = /^\s*(?:pessoas?|partes?|vezes)\b/u;

const TITLE_STOP_RE = new RegExp(
  `\\d|r\\$|,|\\.|\\b(?:${WORD_NUM_SRC})\\b|(?:^|\\s)(?:com|paguei|pagou|dividid[oa]|rachad[oa]|entre|pra|para|eu|reais?)(?:\\s|$)`,
  "u",
);
const PLACE_RE = /\b(?:no|na)\s+(\p{L}+)/u;
const TITLE_TRAILING_SKIP_RE = new RegExp(
  `^(?:e|o|a|os|as|de|do|da|no|na|em|com|que|quem|eu|paguei|pagou|reais?|centavos?|(?:${WORD_NUM_SRC}))$`,
  "iu",
);

const KNOWN_NOUNS_SRC =
  "uber|táxi|taxi|pizza|mercado|bar|café|almoço|jantar|lanche|conta|cinema|padaria|farmácia|ifood";
const PEOPLE_RE = new RegExp(
  `\\bcom\\s+(?:(?:[oa]s?|meus?|minhas?)\\s+)?([\\p{L}][\\p{L}\\s,]*?)(?=\\s*(?:$|[\\d.,]|r\\$|(?:\\s+e)?\\s+(?:paguei|pagou|eu)\\b|\\s+(?:${KNOWN_NOUNS_SRC}|pessoas?|partes?|vezes|reais?|centavos?|deu|foi|no|na|com)\\b))`,
  "iu",
);
const NOT_A_NAME: Record<string, true> = {
  eu: true,
  quem: true,
  que: true,
  ele: true,
  ela: true,
  você: true,
  mais: true,
  todos: true,
};

/** "e cinquenta centavos" / "e meio" — centavos in words, unambiguous, so they are masked out of amount matching. */
const STRICT_CENTS_RE = new RegExp(
  `\\be\\s+((?:${WORD_NUM_SRC})(?:\\s+e\\s+(?:${WORD_NUM_SRC}))*)\\s+centavos\\b|\\be\\s+meio\\b`,
  "giu",
);
/** "e 50" / "e cinquenta" right after an amount; digits are safe everywhere, words only after a digit amount ("120 e cinquenta"), never inside "vinte e cinco". */
const BARE_CENTS_RE = new RegExp(
  `^e\\s+(?:(\\d{1,2})\\b(?:\\s+centavos\\b)?|(${WORD_NUM_SRC}(?:\\s+e\\s+${WORD_NUM_SRC})*))(?!\\s*reais?)`,
  "iu",
);

function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1);
}

function wordNumberValue(spoken: string): number | null {
  let total = 0;
  let current = 0;
  for (const word of spoken.split(/\s+/u)) {
    if (word === "e") continue;
    const value = NUMBER_WORDS[word];
    if (value === undefined) return null;
    if (word === "mil") {
      total += (current || 1) * 1000;
      current = 0;
    } else {
      current += value;
    }
  }
  return total + current;
}

/**
 * Reads a digit cluster with PT-BR separators. A lone three-digit comma group
 * ("12,345") is ambiguous between thousands and decimals, so it is refused
 * instead of guessed.
 */
function digitParts(raw: string): { reais: number; cents: number } | null {
  if (!/[.,]/u.test(raw)) return { reais: Number(raw), cents: 0 };
  const groups = raw.split(/[.,]/u);
  const separators = raw.match(/[.,]/gu) ?? [];
  const uniformDots = separators.every((s) => s === ".");
  const uniformCommas = separators.every((s) => s === ",");
  if (uniformDots || uniformCommas) {
    const thousands = groups.slice(1).every((g) => g.length === 3) && (uniformDots || groups.length > 2);
    if (thousands) return { reais: Number(groups.join("")), cents: 0 };
    if (groups.length !== 2) return null;
    const frac = groups[1];
    if (frac.length > 2) return null;
    return { reais: Number(groups[0]), cents: Number(frac.padEnd(2, "0")) };
  }
  const lastSepIndex = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  const intRaw = raw.slice(0, lastSepIndex).replace(/[.,]/gu, "");
  const frac = raw.slice(lastSepIndex + 1);
  if (frac.length > 2 || !/^\d+$/u.test(intRaw)) return null;
  return { reais: Number(intRaw), cents: Number(frac.padEnd(2, "0")) };
}

interface AmountHit {
  cents: number;
  explicit: boolean;
  start: number;
  end: number;
  fromDigits: boolean;
}

interface CentsClause {
  start: number;
  end: number;
  cents: number;
}

function maskSpans(text: string, spans: CentsClause[]): string {
  const chars = Array.from(text);
  for (const span of spans) {
    for (let i = span.start; i < span.end; i += 1) chars[i] = " ";
  }
  return chars.join("");
}

function strictCentsClauses(text: string): CentsClause[] {
  const clauses: CentsClause[] = [];
  for (const match of text.matchAll(STRICT_CENTS_RE)) {
    const value = match[1] ? wordNumberValue(match[1]) : 50;
    if (value === null || value <= 0 || value >= 100) continue;
    const start = match.index ?? 0;
    clauses.push({ start, end: start + match[0].length, cents: value });
  }
  return clauses;
}

function isCountContext(text: string, start: number, end: number): boolean {
  return COUNT_BEFORE_RE.test(text.slice(0, start)) || COUNT_AFTER_RE.test(text.slice(end));
}

function attachCents(masked: string, clauses: CentsClause[], hit: AmountHit): number {
  for (const clause of clauses) {
    if (clause.start < hit.end) continue;
    if (!/^\s*(?:reais?\s+)?$/u.test(masked.slice(hit.end, clause.start))) continue;
    return hit.cents + clause.cents;
  }
  const gap = /^\s*(?:reais?\s+)?/u.exec(masked.slice(hit.end))?.[0] ?? "";
  const bare = BARE_CENTS_RE.exec(masked.slice(hit.end + gap.length));
  if (!bare) return hit.cents;
  if (bare[2] !== undefined) {
    if (!hit.fromDigits) return hit.cents;
    const value = wordNumberValue(bare[2]);
    if (value === null || value <= 0 || value >= 100) return hit.cents;
    return hit.cents + value;
  }
  return hit.cents + Number(bare[1]);
}

function amountFrom(text: string): { cents: number; start: number; end: number } | null {
  const clauses = strictCentsClauses(text);
  const masked = maskSpans(text, clauses);
  const hits: AmountHit[] = [];
  for (const match of masked.matchAll(DIGIT_MONEY_RE)) {
    const parts = digitParts(match[1]);
    if (!parts) continue;
    const cents = parts.reais * 100 + parts.cents;
    if (cents <= 0 || cents > MAX_AMOUNT_CENTS) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (isCountContext(masked, start, end)) continue;
    hits.push({
      cents,
      explicit: match[0].startsWith("r$") || /^\s*(?:reais?|contos?|pila)\b/u.test(masked.slice(end)),
      start,
      end,
      fromDigits: true,
    });
  }
  for (const match of masked.matchAll(WORD_NUM_RE)) {
    const value = wordNumberValue(match[0]);
    if (value === null || value <= 0) continue;
    const cents = value * 100;
    if (cents > MAX_AMOUNT_CENTS) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (isCountContext(masked, start, end)) continue;
    hits.push({ cents, explicit: /^\s*reais?\b/u.test(masked.slice(end)), start, end, fromDigits: false });
  }
  hits.sort((a, b) => {
    if (a.explicit !== b.explicit) return a.explicit ? -1 : 1;
    if (a.fromDigits !== b.fromDigits) return a.fromDigits ? -1 : 1;
    return a.start - b.start;
  });
  for (const hit of hits) {
    const cents = attachCents(masked, clauses, hit);
    if (cents > 0 && cents <= MAX_AMOUNT_CENTS) return { cents, start: hit.start, end: hit.end };
  }
  return null;
}

function titleFrom(text: string, amount: { start: number; end: number } | null): string | null {
  const stop = text.search(TITLE_STOP_RE);
  const lead = (stop === -1 ? text : text.slice(0, stop)).trim();
  const words = lead.split(/\s+/u).filter((word) => /\p{L}/u.test(word));
  if (words.length > 0 && words[0] !== "paguei" && words[0] !== "eu") {
    return capitalize(words.slice(0, MAX_TITLE_WORDS).join(" "));
  }
  const place = PLACE_RE.exec(text);
  if (place) return capitalize(place[1]);
  if (!amount) return null;
  for (const word of text.slice(amount.end).split(/\s+/u)) {
    const letters = word.replace(/\P{L}/gu, "").toLocaleLowerCase("pt-BR");
    if (!letters || TITLE_TRAILING_SKIP_RE.test(letters)) continue;
    return capitalize(letters);
  }
  return null;
}

function peopleFrom(text: string): string[] {
  const match = PEOPLE_RE.exec(text);
  if (!match) return [];
  const people: string[] = [];
  for (const token of match[1].split(/\s*,\s*|\s+e\s+/u)) {
    const name = token
      .trim()
      .replace(/^(?:[oa]s?|meus?|minhas?)\s+/u, "")
      .split(/\s+/u)
      .map(capitalize)
      .join(" ");
    const key = name.toLocaleLowerCase("pt-BR");
    if (name.length <= 1 || NOT_A_NAME[key] || NUMBER_WORDS[key] !== undefined) continue;
    if (people.some((other) => other.toLocaleLowerCase("pt-BR") === key)) continue;
    people.push(name);
    if (people.length === MAX_PEOPLE) break;
  }
  return people;
}

export function sketchVoiceBill(spoken: string): VoiceBillSketch {
  const text = spoken.toLocaleLowerCase("pt-BR").replace(/\s+/gu, " ").trim();
  if (!text) return EMPTY_VOICE_BILL_SKETCH;
  const amount = amountFrom(text);
  return {
    title: titleFrom(text, amount),
    amountCents: amount?.cents ?? null,
    people: peopleFrom(text),
  };
}
