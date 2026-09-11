/**
 * SEFAZ NFC-e HTML page parser.
 *
 * Brazilian NFC-e (Nota Fiscal de Consumidor Eletrônica) consultation pages
 * are served by each state's SEFAZ portal. The HTML layout varies across states,
 * but they generally share common patterns:
 *
 * - Items are displayed in a table or repeated div/span structure
 * - Each item row contains: description, quantity, unit price, total price
 * - The merchant name appears near the top (CNPJ/Razão Social section)
 * - A total value is displayed at the bottom
 *
 * This parser uses cheerio to extract structured data from these pages,
 * attempting multiple selectors to handle state-specific variations.
 */
import * as cheerio from "cheerio";
import type { ReceiptItem, ReceiptOcrResult } from "./receipt-ocr";
import { unitPriceCentsForLineTotal } from "./expense-quantity";

/** Result of a SEFAZ page fetch attempt. */
export interface SefazFetchResult {
  ok: boolean;
  html?: string;
  error?: string;
}

/**
 * Hostname allowlist for SEFAZ NFC-e portals. Matches `<sub>.<token>.<uf>.gov.br`
 * where token is a state tax-authority label. `svrs` is the Sefaz Virtual do RS,
 * which serves NFC-e consultation for ~10 states (e.g. `nfe.svrs.rs.gov.br`).
 */
export const SEFAZ_DOMAIN_PATTERN =
  /\.(fazenda|sefaz|sef|svrs)\.[a-z]{2}\.gov\.br$/i;

/** Maximum number of redirects to follow when fetching a SEFAZ page. */
const MAX_SEFAZ_REDIRECTS = 5;

/**
 * Whether a URL is an allowed SEFAZ portal endpoint. Enforces http(s) and an
 * allowlisted government hostname. Used both to validate the inbound URL and to
 * re-validate every redirect hop, so a SEFAZ open-redirect cannot pivot the
 * server to an internal host. The `.gov.br` suffix excludes IP literals; it does
 * not defend against DNS rebinding of an allowlisted name (out of scope — the
 * threat closed here is the open-redirect pivot, not DNS-level SSRF).
 */
export function isAllowedSefazUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  return SEFAZ_DOMAIN_PATTERN.test(parsed.hostname);
}

/**
 * Largest SEFAZ page we will decode. Content-Length is advisory and absent on
 * chunked responses, so the cap is enforced on decoded bytes as they arrive.
 */
const MAX_SEFAZ_BODY_BYTES = 2 * 1024 * 1024;

/**
 * The HTTPS URL to fetch for an allowlisted SEFAZ target, or `null` when the
 * target is not allowed. A plaintext `http:` URL is upgraded rather than
 * fetched: nothing on a fiscal portal is worth sending in the clear, and the
 * upgrade applies to the inbound URL and to every redirect hop.
 */
export function httpsSefazUrl(url: string): string | null {
  if (!isAllowedSefazUrl(url)) return null;

  const parsed = new URL(url);
  parsed.protocol = "https:";
  return parsed.toString();
}

/**
 * Reads a response body as text, stopping at `maxBytes`.
 *
 * @returns The decoded text, or `null` when the body exceeded the cap (the
 * stream is cancelled before that happens, so nothing oversized is parsed).
 */
async function readCappedText(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const body = response.body;
  if (!body) return await response.text();

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;

      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  return text + decoder.decode();
}

/** Label text used by SEFAZ portals to identify the fiscal access-key field. */
const ACCESS_KEY_LABEL_PATTERN = /chave\s*de\s*acesso|access\s*key/i;

/** Attribute text that names a fiscal access-key field. */
const ACCESS_KEY_ATTRIBUTE_PATTERN =
  /chave(?:de)?acesso|accesskey|nfcechave|chavenfe/i;

/**
 * Normalize a chave de acesso to its bare 44-digit form.
 * SEFAZ portals print the key formatted with spaces, dots, or hyphens
 * between groups of four digits; only the digits are meaningful.
 *
 * @returns The 44-digit identity, or `null` when the text is not exactly one.
 */
export function normalizeAccessKey(raw: string): string | null {
  const scrubbed = raw.replace(/[\s.\-]/g, "");
  return /^\d{44}$/.test(scrubbed) ? scrubbed : null;
}

/**
 * Collect distinct 44-digit candidates inside a dedicated field region.
 * The region text is scrubbed of the formatting separators SEFAZ portals use;
 * a run of more than 44 digits means the region mixes in unrelated numbers,
 * so it is skipped instead of yielding a truncated candidate.
 */
function accessKeyCandidatesInText(text: string): string[] {
  const scrubbed = text.replace(/[\s.\-]/g, "");
  const candidates = new Set<string>();
  for (const run of scrubbed.match(/\d{44,}/g) ?? []) {
    if (run.length === 44) candidates.add(run);
  }
  return [...candidates];
}

/** User-visible content of a field node (inputs expose their `value`). */
function readFieldText(
  $: cheerio.CheerioAPI,
  node: Parameters<cheerio.CheerioAPI>[0],
): string {
  const $node = $(node);
  const tagName = String($node.prop("tagName") ?? "").toLowerCase();
  if (tagName === "input") {
    return $node.attr("value") ?? "";
  }
  if (tagName === "textarea") {
    const clone = $node.clone();
    clone.find("script, style, a, noscript").remove();
    return clone.text();
  }
  const clone = $node.clone();
  clone.find("script, style, a, noscript").remove();
  return clone.text();
}

/**
 * Extract the distinct 44-digit fiscal access keys (chave de acesso) that a
 * SEFAZ consultation page declares in *dedicated* access-key fields.
 *
 * Only two layouts are accepted:
 * 1. An element whose id/class/name/aria-label names it as the access-key
 *    field and whose own content is the key value.
 * 2. A label/heading ("Chave de acesso"/"Access key") paired with an adjacent
 *    value (`th`/`td`, `dt`/`dd`, label/span, span/span, …) or an inline
 *    "Chave de acesso: <key>" value, or held by the label's bounded row/field
 *    container.
 *
 * A key that appears only in free body text, an anchor/link, a script, or the
 * request URL is never reported — identity must come from a field the portal
 * dedicates to it. Values are normalized (spaces/dots/hyphens removed) and
 * de-duplicated.
 *
 * @param html - Full SEFAZ page HTML
 * @returns Distinct normalized access keys found in dedicated fields
 */
export function extractSefazAccessKeys(html: string): string[] {
  const $ = cheerio.load(html);
  const found = new Set<string>();

  const addCandidateText = (text: string | undefined | null) => {
    if (!text) return;
    for (const key of accessKeyCandidatesInText(text)) found.add(key);
  };

  $("[id], [class], [name], [aria-label]").each((_, el) => {
    const tagName = (el.tagName ?? "").toLowerCase();
    const $el = $(el);
    if (tagName === "script" || tagName === "style" || tagName === "a" || tagName === "noscript") return;
    if ($el.closest("script, style, a, noscript").length > 0) return;
    if (
      $el.attr("hidden") !== undefined ||
      $el.attr("aria-hidden") === "true" ||
      (tagName === "input" && ($el.attr("type") ?? "").toLowerCase() === "hidden")
    ) {
      return;
    }
    const identity = ["id", "class", "name", "aria-label"]
      .map((attr) => $el.attr(attr) ?? "")
      .join(" ");
    if (!ACCESS_KEY_ATTRIBUTE_PATTERN.test(identity.replace(/[\s_-]+/g, ""))) return;
    const text = readFieldText($, el);
    if (!text || text.length > 400) return;
    addCandidateText(text);
  });

  $("label, th, dt, td, span, b, strong, p, div").each((_, el) => {
    const $el = $(el);
    if ($el.closest("script, style, a, noscript").length > 0) return;
    const directText = $el.clone().children().remove().end().text().trim();
    if (!directText || directText.length > 80) return;
    if (!ACCESS_KEY_LABEL_PATTERN.test(directText)) return;

    const fieldText = $el
      .clone()
      .find("script, style, a, noscript")
      .remove()
      .end()
      .text()
      .trim();
    const inline = fieldText.match(
      /^\s*(?:chave\s*de\s*acesso|access\s*key)\s*[:\-]?\s*(.*)$/i,
    );
    if (inline && /^[\d\s.\-]*$/.test(inline[1])) {
      addCandidateText(inline[1]);
    }

    const valueEl = $el
      .nextAll("td, dd, span, div, p, b, strong, input, textarea")
      .first();
    const valueNode = valueEl.get(0);
    const valueTagName = (valueNode?.tagName ?? "").toLowerCase();
    const valueIsHidden =
      valueEl.attr("hidden") !== undefined ||
      valueEl.attr("aria-hidden") === "true" ||
      (valueTagName === "input" &&
        (valueEl.attr("type") ?? "").toLowerCase() === "hidden");
    if (
      valueNode &&
      !valueIsHidden &&
      !ACCESS_KEY_LABEL_PATTERN.test(valueEl.text().trim().slice(0, 80))
    ) {
      addCandidateText(readFieldText($, valueNode));
    }

    const container = $el.closest(
      "tr, dl, li, fieldset, .form-group, .form-field, .row, .campo",
    );
    if (container.length > 0) {
      const containerClone = container.clone();
      containerClone.find("script, style, a, noscript").remove();
      const containerText = containerClone.text();
      if (containerText.length <= 400) addCandidateText(containerText);
    }
  });

  return [...found];
}

/** Centavos: two decimals. */
const CENTS_SCALE = 2;

/** Quantities are milliunits, matching `parseExpenseQuantity`. */
const QUANTITY_SCALE = 3;

/** Printed unit rates are kept to six decimals (micro-centavos). */
const UNIT_RATE_SCALE = 6;

/** Micro-centavos in one centavo. */
const MICRO_CENTS_PER_CENT = 10_000;

/** Milliunits in one unit. */
const MILLIUNITS_PER_UNIT = 1000;

/**
 * Builds a receipt row whose arithmetic the ledger will accept, or rejects it.
 *
 * The printed line total is what the customer paid, so it is authoritative.
 * A unit rate finer than a centavo cannot be stored as one, so the row keeps
 * the centavo rate that reproduces the printed total exactly. When no such
 * rate exists, or when the printed rate and quantity do not produce the
 * printed total, the row is dropped rather than silently repaired.
 */
function reconcileRow(input: {
  description: string;
  quantityMilliunits: number;
  unitRateMicroCents: number;
  totalCents: number;
}): ReceiptItem | null {
  const { description, quantityMilliunits, unitRateMicroCents, totalCents } = input;
  if (quantityMilliunits <= 0 || unitRateMicroCents <= 0 || totalCents <= 0) return null;

  // One rounding, at the line total: micro-centavos x milliunits / 10^9.
  const scaled =
    BigInt(quantityMilliunits) * BigInt(unitRateMicroCents);
  const divisor = BigInt(MICRO_CENTS_PER_CENT) * BigInt(MILLIUNITS_PER_UNIT);
  const derivedTotal = Number((scaled + divisor / BigInt(2)) / divisor);
  if (derivedTotal !== totalCents) return null;

  const unitPriceCents = unitPriceCentsForLineTotal(quantityMilliunits, totalCents);
  if (unitPriceCents === null) return null;

  return {
    description: cleanDescription(description),
    quantity: quantityMilliunits / MILLIUNITS_PER_UNIT,
    unitPriceCents: unitPriceCents as number,
    totalCents,
  };
}

/**
 * Reads a printed decimal into an integer scaled by `10^scale`, exactly.
 *
 * Printed money is a decimal string, so float arithmetic has no business
 * here: `parseFloat("0.07") * 100` is 7.000000000000001, and a receipt that
 * rounds the wrong way is a receipt the ledger refuses.
 *
 * @returns The scaled integer, or `null` when the text is not a single
 * decimal or carries more precision than `scale` holds.
 */
function parseDecimalScaled(raw: string, scale: number): number | null {
  const cleaned = raw.trim().replace(/R\$\s*/i, "").replace(/\s/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let digits: string;
  if (lastComma > lastDot) {
    // Brazilian standard: dots group thousands, the comma is the decimal.
    digits = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma === -1) {
    const afterDot = cleaned.slice(lastDot + 1);
    // A single dot with exactly three digits after it is a thousands
    // separator, not a decimal: "1.234" is 1234, never 1.234.
    digits =
      afterDot.length === 3 && cleaned.indexOf(".") === lastDot
        ? cleaned.replace(/\./g, "")
        : cleaned;
  } else if (lastDot > lastComma) {
    digits = cleaned.replace(/,/g, "");
  } else {
    digits = cleaned;
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(digits);
  if (!match) return null;

  const fractional = match[2] ?? "";
  if (fractional.length > scale) return null;

  const scaled = Number(match[1] + fractional.padEnd(scale, "0"));
  return Number.isSafeInteger(scaled) ? scaled : null;
}

/**
 * Parse a Brazilian currency string into integer centavos.
 * Handles formats like "12,50", "1.234,56", "12.50" (dot as decimal).
 * Returns 0 when the string is not a currency amount in centavos.
 */
export function parseBrlToCents(raw: string): number {
  return parseDecimalScaled(raw, CENTS_SCALE) ?? 0;
}

/**
 * Printed unit rates can carry more precision than a centavo: weighed goods
 * are priced at three or four decimals. Reading them as micro-centavos keeps
 * the printed rate intact so the line total rounds exactly once.
 */
function parseUnitRateMicroCents(raw: string): number | null {
  return parseDecimalScaled(raw, UNIT_RATE_SCALE);
}

/**
 * Parse a printed quantity into milliunits, the ledger's own precision.
 *
 * @returns The quantity in milliunits, or `null` when it is absent, not a
 * number, zero, or finer than milliunits. A quantity we cannot read exactly
 * is never guessed as 1: that would invent a line the receipt never printed.
 */
function parseQuantityMilliunits(raw: string): number | null {
  const milliunits = parseDecimalScaled(raw, QUANTITY_SCALE);
  if (milliunits === null || milliunits <= 0) return null;
  return milliunits;
}

/**
 * Try to extract the merchant name from the SEFAZ page.
 * Looks for common patterns across state layouts.
 */
function extractMerchant($: cheerio.CheerioAPI): string | null {
  // Strategy 1: Look for elements with class containing "emit" (emitente)
  const emitSelectors = [
    ".txtTopo", // SP, common layout
    ".emit .txtTopo",
    "#u20", // Some states use ID-based layout
    ".NFCDetalhe_Emitente",
    ".GeralXs662 .txtTopo",
    '[class*="emit"] [class*="txt"]',
    ".nfce-emit .razao",
  ];

  for (const sel of emitSelectors) {
    const el = $(sel).first();
    if (el.length) {
      const text = el.text().trim();
      if (text && text.length > 2 && text.length < 200) return text;
    }
  }

  // Strategy 2: Search for text near "Razão Social" or "CNPJ"
  const allText = $("body").text();
  const razaoMatch = allText.match(
    /Raz[aã]o\s*Social[:\s]*([^\n\r]{3,80})/i,
  );
  if (razaoMatch) return razaoMatch[1].trim();

  // Strategy 3: Look for the first large bold text (often the merchant name)
  const firstBold = $("body b, body strong").first();
  if (firstBold.length) {
    const text = firstBold.text().trim();
    if (text.length > 3 && text.length < 100 && !/CNPJ|CPF|NFC/i.test(text)) {
      return text;
    }
  }

  return null;
}

/**
 * Try to extract an explicitly stated service fee percentage from the SEFAZ
 * page, converted to integer basis points. Brazilian restaurants often add a
 * 10% "taxa de serviço" which may appear as a line item, a summary row, or
 * in the page text. Never derives a percentage from a monetary fee value
 * divided by a subtotal (issue #477: that ratio is never printed on the
 * page as ground truth, so computing it would fabricate a value the source
 * never stated). Returns 0 basis points if no explicit percentage is found.
 */
function extractServiceFeeBasisPoints($: cheerio.CheerioAPI): number {
  const bodyText = $("body").text();

  // Explicit percentage mention — "Taxa de Serviço (10%)" or "Serviço: 10%"
  const percentMatch = bodyText.match(
    /(?:taxa\s*(?:de\s*)?servi[çc]o|servi[çc]o)\s*[:(]?\s*(\d{1,2})[,.]?(\d{0,2})\s*%/i,
  );
  if (percentMatch) {
    const whole = parseInt(percentMatch[1], 10);
    const fracDigits = percentMatch[2] ?? "";
    // Exact integer basis points from the printed digits — never a float
    // division. "10" -> 1000; "10,5" -> 1050; "10,55" -> 1055.
    const fracBps = fracDigits.length === 0
      ? 0
      : fracDigits.length === 1
        ? parseInt(fracDigits, 10) * 10
        : parseInt(fracDigits, 10);
    const bps = whole * 100 + fracBps;
    if (bps > 0 && bps <= 3000) return bps;
  }

  return 0;
}

/**
 * A service fee printed as an amount rather than a rate.
 *
 * Several portals print "Taxa de serviço: R$ 10,00" with no percentage, and
 * reading only percentages left the fee out of the receipt entirely: the
 * items summed to less than the printed total and the whole receipt was
 * rejected as unreconciled.
 *
 * @returns The fee in centavos, or 0 when the page prints none.
 */
function extractFixedFeeCents($: cheerio.CheerioAPI): number {
  const bodyText = $("body").text();
  const amountMatch = bodyText.match(
    /(?:taxa\s*(?:de\s*)?servi[çc]o|servi[çc]o|acr[ée]scimo[s]?)\s*[:(]?\s*R?\$?\s*([\d.,]+)/i,
  );
  if (!amountMatch) return 0;

  const cents = parseBrlToCents(amountMatch[1]);
  return cents > 0 ? cents : 0;
}

/**
 * Try to extract the total value from the SEFAZ page.
 */
function extractTotal($: cheerio.CheerioAPI): number {
  // Strategy 1: Look for elements with total-related classes
  const totalSelectors = [
    ".txtMax", // SP common
    "#linhaTotal .txtMax",
    ".totalNota .txtMax",
    ".NFCDetalhe_Total",
    '[class*="total"] [class*="valor"]',
    ".total .valor",
  ];

  for (const sel of totalSelectors) {
    const el = $(sel).last(); // Last match is usually the grand total
    if (el.length) {
      const cents = parseBrlToCents(el.text());
      if (cents > 0) return cents;
    }
  }

  // Strategy 2: Search text for "TOTAL" followed by a value
  const totalMatch = $("body")
    .text()
    .match(
      /(?:VALOR\s*TOTAL|TOTAL\s*(?:DA\s*NOTA|R\$|:))\s*[R$\s]*(\d[\d.,]*)/i,
    );
  if (totalMatch) {
    const cents = parseBrlToCents(totalMatch[1]);
    if (cents > 0) return cents;
  }

  return 0;
}

/** Where each meaningful value sits in a labelled item table. */
interface ColumnMap {
  description: number;
  quantity: number;
  unitRate: number;
  total: number;
}

const DESCRIPTION_LABEL = /descri[çc][aã]o|produto|item/i;
const QUANTITY_LABEL = /qtd|quant/i;
const UNIT_LABEL = /unit|unit[áa]rio/i;
const TOTAL_LABEL = /total|valor/i;

/**
 * Reads column meaning from a header row.
 *
 * @returns The mapping, or `null` when the header does not name all four
 * values: guessing by position is what imported the wrong number.
 */
function columnMapFrom(headerTexts: readonly string[]): ColumnMap | null {
  const find = (pattern: RegExp, exclude?: RegExp): number =>
    headerTexts.findIndex((text) => {
      const value = text.trim();
      if (!pattern.test(value)) return false;
      return exclude === undefined || !exclude.test(value);
    });

  const description = find(DESCRIPTION_LABEL);
  const quantity = find(QUANTITY_LABEL);
  // "Vl. Unit" and "Vl. Total" both match a bare total/valor pattern, so the
  // unit column is excluded from the total lookup explicitly.
  const unitRate = find(UNIT_LABEL);
  const total = find(TOTAL_LABEL, UNIT_LABEL);

  if (description < 0 || quantity < 0 || unitRate < 0 || total < 0) return null;
  return { description, quantity, unitRate, total };
}

/** Builds a row from labelled columns, rejecting anything that cannot be read. */
function parseItemFromColumns(
  texts: readonly string[],
  columns: ColumnMap,
): ReceiptItem | null {
  const description = texts[columns.description]?.trim() ?? "";
  if (!description) return null;

  const quantityMilliunits = parseQuantityMilliunits(texts[columns.quantity] ?? "");
  const unitRateMicroCents = parseUnitRateMicroCents(texts[columns.unitRate] ?? "");
  const totalCents = parseBrlToCents(texts[columns.total] ?? "");
  if (quantityMilliunits === null || unitRateMicroCents === null) return null;

  return reconcileRow({
    description,
    quantityMilliunits,
    unitRateMicroCents,
    totalCents,
  });
}

/**
 * Primary extraction strategy: table-based layouts.
 * Many SEFAZ pages render items in a <table> with structured columns.
 */
function extractFromTable(
  $: cheerio.CheerioAPI,
): ReceiptItem[] | null {
  // Look for product tables
  const tableSelectors = [
    "table.toggable", // Common in several states
    "#tabResult table",
    "table.toggle",
    "#myTable",
    "table",
  ];

  for (const sel of tableSelectors) {
    const tables = $(sel);
    if (!tables.length) continue;

    const items: ReceiptItem[] = [];

    tables.each((_, table) => {
      const rows = $(table).find("tr");
      // Column meaning comes from the header when the table has one, so a
      // layout that prints code, description, quantity, unit and total is
      // read by label instead of by "the first three numbers".
      let columns: ColumnMap | null = null;

      rows.each((__, row) => {
        const cells = $(row).find("td");
        const headerCells = $(row).find("th");
        if (headerCells.length >= 3 && columns === null) {
          columns = columnMapFrom(headerCells.map((___, cell) => $(cell).text()).get());
          return;
        }
        if (cells.length < 3) return;

        const texts = cells.map((___, cell) => $(cell).text().trim()).get();

        // Skip header rows
        if (
          texts.some(
            (t) =>
              /^(Descri[çc][aã]o|Produto|Item|C[oó]d|Qtd|#)$/i.test(t),
          )
        ) {
          if (columns === null) columns = columnMapFrom(texts);
          return;
        }

        const item = columns
          ? parseItemFromColumns(texts, columns)
          : parseItemFromTexts(texts);
        if (item) items.push(item);
      });
    });

    if (items.length > 0) return items;
  }

  return null;
}

/**
 * Secondary extraction strategy: div-based layouts (SP "detalhes" pattern).
 * São Paulo and several other states use nested divs with specific classes.
 */
function extractFromDivs(
  $: cheerio.CheerioAPI,
): ReceiptItem[] | null {
  // SP-style layout: div with class containing "Prod" or "det"
  const containerSelectors = [
    "#myTable .det",
    "#tabResult .det",
    ".NFCDetalhe_Item",
    '[class*="Prod"]',
    ".det",
  ];

  for (const sel of containerSelectors) {
    const matched = $(sel).toArray();
    if (matched.length === 0) continue;

    // A selector like [class*="Prod"] matches a wrapper and the row inside
    // it, which imported the same item twice. Only the innermost match is a
    // row, so any element that contains another match is dropped.
    const containers = matched.filter(
      (candidate) =>
        !matched.some(
          (other) => other !== candidate && $.contains(candidate, other),
        ),
    );

    const items: ReceiptItem[] = [];

    for (const container of containers) {
      const el = $(container);

      // An empty Cheerio selection is still truthy, so the `desc` fallback
      // never ran and rows titled only by `.desc` were dropped.
      const titleEl = el.find('[class*="txtTit"]').first();
      const descEl = titleEl.length > 0 ? titleEl : el.find('[class*="desc"]').first();
      const description = descEl.length > 0 ? descEl.text().trim() : "";

      // Look for quantity, unit price, total in child elements
      const allText = el.text();

      // Common patterns: "Qtde.: 2,000" "UN: UN" "Vl. Unit.: 15,90" "Vl. Total: 31,80"
      const qtyMatch = allText.match(
        /Qtd[e.]?[.:]*\s*([\d.,]+)/i,
      );
      const unitMatch = allText.match(
        /(?:Vl\.?\s*Unit|V[.\s]*Unit[áa]rio|Pre[çc]o\s*Unit)[.:]*\s*R?\$?\s*([\d.,]+)/i,
      );
      const totalMatch = allText.match(
        /(?:Vl\.?\s*Total|V[.\s]*Total|Total)[.:]*\s*R?\$?\s*([\d.,]+)/i,
      );

      if (description && qtyMatch && unitMatch && totalMatch) {
        const quantityMilliunits = parseQuantityMilliunits(qtyMatch[1]);
        const unitRateMicroCents = parseUnitRateMicroCents(unitMatch[1]);
        const totalCents = parseBrlToCents(totalMatch[1]);

        // Never derive a missing unit price or total from the other value
        // (issue #477): the row is only kept when the printed quantity, rate
        // and total are all present and reconcile exactly.
        if (quantityMilliunits !== null && unitRateMicroCents !== null) {
          const row = reconcileRow({
            description,
            quantityMilliunits,
            unitRateMicroCents,
            totalCents,
          });
          if (row) items.push(row);
        }
      }
    }

    if (items.length > 0) return items;
  }

  return null;
}

/**
 * Tertiary extraction strategy: regex-based text parsing.
 * Fallback when neither table nor div selectors match.
 * Scans the full text for repeated item-like patterns.
 */
function extractFromText(
  $: cheerio.CheerioAPI,
): ReceiptItem[] | null {
  const bodyText = $("body").text();

  // Pattern: "DESCRIPTION QTY UN VL_UNIT VL_TOTAL"
  // or: "1 DESCRIPTION 2,000 UN 15,90 31,80"
  const linePattern =
    /(\d+)\s+(.{3,60}?)\s+([\d.,]+)\s+(?:UN|KG|LT|PC|PCT|CX|GR|ML|M2|M3|PAR|DZ|FD)\s+([\d.,]+)\s+([\d.,]+)/gi;

  const items: ReceiptItem[] = [];
  let match;

  while ((match = linePattern.exec(bodyText)) !== null) {
    const description = match[2].trim();
    const quantityMilliunits = parseQuantityMilliunits(match[3]);
    const unitRateMicroCents = parseUnitRateMicroCents(match[4]);
    const totalCents = parseBrlToCents(match[5]);

    if (description && quantityMilliunits !== null && unitRateMicroCents !== null) {
      const row = reconcileRow({
        description,
        quantityMilliunits,
        unitRateMicroCents,
        totalCents,
      });
      if (row) items.push(row);
    }
  }

  if (items.length > 0) return items;

  // Simpler pattern: "DESCRIPTION QUANTITY x PRICE = TOTAL"
  const simplePattern =
    /(.{3,60}?)\s+([\d.,]+)\s*[xX×]\s*R?\$?\s*([\d.,]+)\s*=?\s*R?\$?\s*([\d.,]+)/g;

  while ((match = simplePattern.exec(bodyText)) !== null) {
    const description = match[1].trim();
    const quantityMilliunits = parseQuantityMilliunits(match[2]);
    const unitRateMicroCents = parseUnitRateMicroCents(match[3]);
    const totalCents = parseBrlToCents(match[4]);

    if (description && quantityMilliunits !== null && unitRateMicroCents !== null) {
      const row = reconcileRow({
        description,
        quantityMilliunits,
        unitRateMicroCents,
        totalCents,
      });
      if (row) items.push(row);
    }
  }

  return items.length > 0 ? items : null;
}

/**
 * Try to parse an item from an array of text values extracted from a table row.
 * Heuristic: the longest non-numeric string is the description,
 * and we look for 2-3 numeric values (qty, unit price, total).
 */
function parseItemFromTexts(texts: string[]): ReceiptItem | null {
  if (texts.length < 2) return null;

  // Find numeric values
  const numericPattern = /^[\d.,]+$/;
  const numbers: { index: number; value: string }[] = [];
  let descIndex = -1;
  let maxDescLen = 0;

  for (let i = 0; i < texts.length; i++) {
    const t = texts[i].replace(/R\$\s*/g, "").trim();
    if (numericPattern.test(t) && t.length > 0) {
      numbers.push({ index: i, value: t });
    } else if (texts[i].length > maxDescLen && texts[i].length > 2) {
      maxDescLen = texts[i].length;
      descIndex = i;
    }
  }

  if (descIndex === -1 || numbers.length < 1) return null;

  const description = cleanDescription(texts[descIndex]);
  if (!description) return null;

  // With 3+ numbers: qty, unitPrice, total — only when both unitPrice and
  // total were explicitly present and parsed (issue #477: never solve the
  // inverse `totalCents / quantity` when unitPrice failed to parse).
  if (numbers.length >= 3) {
    const quantityMilliunits = parseQuantityMilliunits(numbers[0].value);
    const unitRateMicroCents = parseUnitRateMicroCents(numbers[1].value);
    const totalCents = parseBrlToCents(numbers[2].value);
    if (quantityMilliunits !== null && unitRateMicroCents !== null) {
      return reconcileRow({
        description,
        quantityMilliunits,
        unitRateMicroCents,
        totalCents,
      });
    }
  }

  // With 1 or 2 numbers, the source states at most one of {quantity, unit
  // price, total} unambiguously alongside the other — solving for the
  // missing value(s) would be a non-unique inverse guess, which issue #477
  // forbids. Reject the item outright instead of guessing.
  return null;
}

/**
 * Clean up an item description: remove excess whitespace, item numbers,
 * leading codes, etc.
 */
function cleanDescription(raw: string): string {
  return (
    raw
      // Remove leading item number patterns like "001 - ", "1) ", "#1 "
      .replace(/^\d{1,4}\s*[-).]\s*/, "")
      // Remove EAN/barcode codes (13-digit numbers)
      .replace(/\b\d{13}\b/g, "")
      // Remove NCM codes (8 digits with dots)
      .replace(/\b\d{4}\.\d{2}\.\d{2}\b/g, "")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Parse a SEFAZ NFC-e consultation page HTML and extract structured receipt data.
 *
 * Uses multiple strategies in sequence:
 * 1. Table-based extraction (most common layout)
 * 2. Div-based extraction (SP and similar states)
 * 3. Regex-based text extraction (fallback)
 *
 * @param html - The full HTML content of a SEFAZ NFC-e consultation page
 * @param expectedReceiptAccessKey - The access key from the scanned QR code.
 * @returns Parsed receipt data only when the page identity matches, or null otherwise
 */
export function parseSefazPage(
  html: string,
  expectedReceiptAccessKey: string,
): ReceiptOcrResult | null {
  const normalizedExpected = normalizeAccessKey(expectedReceiptAccessKey);
  const pageAccessKeys = extractSefazAccessKeys(html);
  if (
    !normalizedExpected ||
    pageAccessKeys.length !== 1 ||
    pageAccessKeys[0] !== normalizedExpected
  ) {
    return null;
  }

  const $ = cheerio.load(html);

  // Try extraction strategies in order of reliability
  const items =
    extractFromTable($) ?? extractFromDivs($) ?? extractFromText($);

  if (!items || items.length === 0) return null;

  const merchant = extractMerchant($);
  const extractedTotal = extractTotal($);

  // Never default a missing receipt root total to the item sum (issue
  // #477): if the page has no explicitly stated total, this page cannot be
  // used and the caller falls back to the photo/manual-entry path.
  if (extractedTotal <= 0) return null;

  const serviceFeeBasisPoints = extractServiceFeeBasisPoints($);
  const itemsSubtotal = items.reduce((sum, item) => sum + item.totalCents, 0);
  // Same half-up rate the ledger and SQL apply, so the parser's arithmetic
  // and the decoder's agree to the centavo.
  const rateFee = Math.floor((itemsSubtotal * serviceFeeBasisPoints + 5_000) / 10_000);

  // A fee printed as an amount only counts when it closes the gap exactly.
  // Guessing one would hand the review screen a total nobody printed.
  const printedFee = extractFixedFeeCents($);
  const gap = extractedTotal - itemsSubtotal - rateFee;
  const fixedFeesCents = gap > 0 && printedFee === gap ? printedFee : 0;

  return {
    merchant,
    items,
    serviceFeeBasisPoints,
    fixedFeesCents,
    totalCents: extractedTotal,
  };
}

/**
 * Fetch an NFC-e consultation page from SEFAZ.
 *
 * @param url - The SEFAZ consultation URL (from QR code)
 * @param timeoutMs - Request timeout in milliseconds (default: 8000)
 * @returns The fetch result with HTML content or error message
 */
export async function fetchSefazPage(
  url: string,
  timeoutMs = 8000,
): Promise<SefazFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  /** Bodies abandoned by an early exit, cancelled before the timer is cleared. */
  const pendingBodies: Response[] = [];

  try {
    let currentUrl = url;
    let response: Response;

    // Follow redirects manually so each hop is re-validated against the SEFAZ
    // allowlist. With `redirect: "follow"`, a SEFAZ open-redirect could pivot the
    // request to an internal host (cloud metadata, RFC1918) — an SSRF vector.
    for (let hop = 0; ; hop++) {
      const target = httpsSefazUrl(currentUrl);
      if (target === null) {
        return { ok: false, error: "URL fora do domínio SEFAZ permitido" };
      }

      response = await fetch(target, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9",
        },
        redirect: "manual",
      });

      if (response.status < 300 || response.status >= 400) {
        break;
      }

      // A redirect body is never read.
      pendingBodies.push(response);

      const location = response.headers.get("location");
      if (!location) {
        break;
      }
      if (hop >= MAX_SEFAZ_REDIRECTS) {
        return { ok: false, error: "Excesso de redirecionamentos" };
      }
      currentUrl = new URL(location, currentUrl).toString();
    }

    if (!response.ok) {
      pendingBodies.push(response);
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      pendingBodies.push(response);
      return {
        ok: false,
        error: `Tipo de conteúdo inesperado: ${contentType}`,
      };
    }

    const body = await readCappedText(response, MAX_SEFAZ_BODY_BYTES);
    if (body === null) {
      return { ok: false, error: "Página da SEFAZ excede o tamanho permitido" };
    }

    // Detect CAPTCHA pages (several SEFAZ portals use reCAPTCHA)
    if (
      body.includes("g-recaptcha") ||
      body.includes("recaptcha") ||
      body.includes("hcaptcha")
    ) {
      return {
        ok: false,
        error: "CAPTCHA detectado na página da SEFAZ",
      };
    }

    return { ok: true, html: body };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "Timeout ao acessar SEFAZ" };
    }
    const message =
      error instanceof Error ? error.message : "Erro desconhecido";
    return { ok: false, error: message };
  } finally {
    // Dispose abandoned bodies while the abort timer is still armed, so a
    // stalled stream cannot keep the connection alive past the deadline.
    await Promise.all(
      pendingBodies.map((abandoned) => abandoned.body?.cancel().catch(() => {})),
    );
    clearTimeout(timer);
  }
}
