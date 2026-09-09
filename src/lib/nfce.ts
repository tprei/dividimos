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

/**
 * Parse a Brazilian currency string into integer centavos.
 * Handles formats like "12,50", "1.234,56", "12.50" (dot as decimal).
 * Returns 0 if the string cannot be parsed.
 */
export function parseBrlToCents(raw: string): number {
  const cleaned = raw.trim().replace(/R\$\s*/i, "");
  if (!cleaned) return 0;

  // Determine if comma or dot is the decimal separator
  // Brazilian format: 1.234,56 (dot=thousands, comma=decimal)
  // Some states use: 1234.56 (dot=decimal, no thousands separator)
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized: string;

  if (lastComma > lastDot) {
    // Comma is the decimal separator (Brazilian standard): "1.234,56" → "1234.56"
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma === -1) {
    // Only dots present — check if it looks like thousands separator
    // "1.234" with no comma is ambiguous, but in NFC-e context
    // values after the dot with exactly 3 digits are thousands separators
    const afterDot = cleaned.slice(lastDot + 1);
    if (afterDot.length === 3 && cleaned.indexOf(".") === lastDot) {
      // Single dot with 3 digits after = thousands: "1.234" → "1234"
      normalized = cleaned.replace(/\./g, "");
    } else {
      // Dot is decimal separator: "12.50" → "12.50"
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (lastDot > lastComma) {
    // Both present, dot is last = dot is decimal: "1,234.56" → "1234.56"
    normalized = cleaned.replace(/,/g, "");
  } else {
    // No separators
    normalized = cleaned;
  }

  const value = parseFloat(normalized);
  if (isNaN(value)) return 0;
  return Math.round(value * 100);
}

/**
 * Parse a quantity string that may use comma as decimal separator.
 * Handles "1", "2,000", "0,500" etc.
 */
function parseQuantity(raw: string): number {
  const cleaned = raw.trim().replace(",", ".");
  const value = parseFloat(cleaned);
  return isNaN(value) || value <= 0 ? 1 : value;
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
      rows.each((__, row) => {
        const cells = $(row).find("td");
        if (cells.length < 3) return;

        // Try to identify columns by header text or position
        const texts = cells
          .map((___, cell) => $(cell).text().trim())
          .get();

        // Skip header rows
        if (
          texts.some(
            (t) =>
              /^(Descri[çc][aã]o|Produto|Item|C[oó]d|Qtd|#)$/i.test(t),
          )
        ) {
          return;
        }

        // Find description (longest text), quantity, unit price, total
        const item = parseItemFromTexts(texts);
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
    const containers = $(sel);
    if (!containers.length) continue;

    const items: ReceiptItem[] = [];

    containers.each((_, container) => {
      const el = $(container);

      // Extract text spans/elements within the container
      const descEl =
        el.find('[class*="txtTit"]').first() ||
        el.find('[class*="desc"]').first();
      const description =
        descEl.length > 0 ? descEl.text().trim() : "";

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
        const quantity = parseQuantity(qtyMatch[1]);
        const unitPriceCents = parseBrlToCents(unitMatch[1]);
        const totalCents = parseBrlToCents(totalMatch[1]);

        // Never derive a missing unit price or total from the other value
        // (issue #477): only push the item when both were explicitly
        // matched and parsed to a positive value.
        if (unitPriceCents > 0 && totalCents > 0) {
          items.push({
            description: cleanDescription(description),
            quantity,
            unitPriceCents,
            totalCents,
          });
        }
      }
    });

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
    const quantity = parseQuantity(match[3]);
    const unitPriceCents = parseBrlToCents(match[4]);
    const totalCents = parseBrlToCents(match[5]);

    if (description && unitPriceCents > 0 && totalCents > 0) {
      items.push({
        description: cleanDescription(description),
        quantity,
        unitPriceCents,
        totalCents,
      });
    }
  }

  if (items.length > 0) return items;

  // Simpler pattern: "DESCRIPTION QUANTITY x PRICE = TOTAL"
  const simplePattern =
    /(.{3,60}?)\s+([\d.,]+)\s*[xX×]\s*R?\$?\s*([\d.,]+)\s*=?\s*R?\$?\s*([\d.,]+)/g;

  while ((match = simplePattern.exec(bodyText)) !== null) {
    const description = match[1].trim();
    const quantity = parseQuantity(match[2]);
    const unitPriceCents = parseBrlToCents(match[3]);
    const totalCents = parseBrlToCents(match[4]);

    if (description && unitPriceCents > 0 && totalCents > 0) {
      items.push({
        description: cleanDescription(description),
        quantity,
        unitPriceCents,
        totalCents,
      });
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
    const quantity = parseQuantity(numbers[0].value);
    const unitPriceCents = parseBrlToCents(numbers[1].value);
    const totalCents = parseBrlToCents(numbers[2].value);
    if (unitPriceCents > 0 && totalCents > 0) {
      return { description, quantity, unitPriceCents, totalCents };
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

  return {
    merchant,
    items,
    serviceFeeBasisPoints,
    fixedFeesCents: 0,
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

  try {
    let currentUrl = url;
    let response: Response;

    // Follow redirects manually so each hop is re-validated against the SEFAZ
    // allowlist. With `redirect: "follow"`, a SEFAZ open-redirect could pivot the
    // request to an internal host (cloud metadata, RFC1918) — an SSRF vector.
    for (let hop = 0; ; hop++) {
      if (!isAllowedSefazUrl(currentUrl)) {
        return { ok: false, error: "URL fora do domínio SEFAZ permitido" };
      }

      response = await fetch(currentUrl, {
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
      return {
        ok: false,
        error: `HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      return {
        ok: false,
        error: `Tipo de conteúdo inesperado: ${contentType}`,
      };
    }

    const html = await response.text();

    // Detect CAPTCHA pages (several SEFAZ portals use reCAPTCHA)
    if (
      html.includes("g-recaptcha") ||
      html.includes("recaptcha") ||
      html.includes("hcaptcha")
    ) {
      return {
        ok: false,
        error: "CAPTCHA detectado na página da SEFAZ",
      };
    }

    return { ok: true, html };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "Timeout ao acessar SEFAZ" };
    }
    const message =
      error instanceof Error ? error.message : "Erro desconhecido";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
