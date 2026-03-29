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
 * Try to extract a service fee percentage from the SEFAZ page.
 * Brazilian restaurants often add a 10% "taxa de serviço" which may
 * appear as a line item, a summary row, or in the page text.
 * Returns 0 if no service fee is found.
 */
function extractServiceFeePercent($: cheerio.CheerioAPI): number {
  const bodyText = $("body").text();

  // Pattern 1: Explicit percentage mention — "Taxa de Serviço (10%)" or "Serviço: 10%"
  const percentMatch = bodyText.match(
    /(?:taxa\s*(?:de\s*)?servi[çc]o|servi[çc]o)\s*[:(]?\s*(\d{1,2})[,.]?(\d{0,2})\s*%/i,
  );
  if (percentMatch) {
    const whole = parseInt(percentMatch[1], 10);
    const frac = percentMatch[2] ? parseInt(percentMatch[2], 10) : 0;
    const pct = frac > 0 ? whole + frac / Math.pow(10, percentMatch[2].length) : whole;
    if (pct > 0 && pct <= 30) return pct;
  }

  // Pattern 2: Service fee as a monetary value — derive percentage from items total
  // Look for "Taxa de Serviço" followed by a currency value
  const feeValueMatch = bodyText.match(
    /(?:taxa\s*(?:de\s*)?servi[çc]o|gorjeta\s*sugerida)\s*[:]?\s*R?\$?\s*([\d.,]+)/i,
  );
  if (feeValueMatch) {
    const feeCents = parseBrlToCents(feeValueMatch[1]);
    if (feeCents > 0) {
      // We need the subtotal (items total) to derive the percentage.
      // Try to find a subtotal value in the page.
      const subtotalMatch = bodyText.match(
        /(?:subtotal|sub[\s-]?total|total\s*(?:dos\s*)?(?:itens|produtos))\s*[:]?\s*R?\$?\s*([\d.,]+)/i,
      );
      if (subtotalMatch) {
        const subtotalCents = parseBrlToCents(subtotalMatch[1]);
        if (subtotalCents > 0) {
          const pct = Math.round((feeCents / subtotalCents) * 100);
          if (pct > 0 && pct <= 30) return pct;
        }
      }
    }
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

      if (description || qtyMatch || unitMatch || totalMatch) {
        const quantity = qtyMatch ? parseQuantity(qtyMatch[1]) : 1;
        const unitPriceCents = unitMatch
          ? parseBrlToCents(unitMatch[1])
          : 0;
        const totalCents = totalMatch
          ? parseBrlToCents(totalMatch[1])
          : 0;

        // Derive missing values where possible
        const finalUnit =
          unitPriceCents ||
          (totalCents && quantity
            ? Math.round(totalCents / quantity)
            : 0);
        const finalTotal =
          totalCents || Math.round(finalUnit * quantity);

        if (description && finalTotal > 0) {
          items.push({
            description: cleanDescription(description),
            quantity,
            unitPriceCents: finalUnit,
            totalCents: finalTotal,
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

    if (description && totalCents > 0) {
      items.push({
        description: cleanDescription(description),
        quantity,
        unitPriceCents:
          unitPriceCents || Math.round(totalCents / quantity),
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

    if (description && totalCents > 0) {
      items.push({
        description: cleanDescription(description),
        quantity,
        unitPriceCents:
          unitPriceCents || Math.round(totalCents / quantity),
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

  // With 3+ numbers: qty, unitPrice, total
  if (numbers.length >= 3) {
    const quantity = parseQuantity(numbers[0].value);
    const unitPriceCents = parseBrlToCents(numbers[1].value);
    const totalCents = parseBrlToCents(numbers[2].value);
    if (totalCents > 0) {
      return {
        description,
        quantity,
        unitPriceCents:
          unitPriceCents || Math.round(totalCents / quantity),
        totalCents,
      };
    }
  }

  // With 2 numbers: assume unitPrice and total (qty=1) or qty and total
  if (numbers.length === 2) {
    const v1 = parseBrlToCents(numbers[0].value);
    const v2 = parseBrlToCents(numbers[1].value);
    if (v2 > 0) {
      if (v1 > 0 && v1 <= v2) {
        // v1=unitPrice, v2=total
        const qty = v2 / v1;
        return {
          description,
          quantity: Math.abs(qty - Math.round(qty)) < 0.01 ? Math.round(qty) : 1,
          unitPriceCents: v1,
          totalCents: v2,
        };
      }
      // v1 might be quantity (non-monetary)
      const qty = parseQuantity(numbers[0].value);
      return {
        description,
        quantity: qty,
        unitPriceCents: Math.round(v2 / qty),
        totalCents: v2,
      };
    }
  }

  // With 1 number: assume it's the total
  if (numbers.length === 1) {
    const totalCents = parseBrlToCents(numbers[0].value);
    if (totalCents > 0) {
      return {
        description,
        quantity: 1,
        unitPriceCents: totalCents,
        totalCents,
      };
    }
  }

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
 * @returns Parsed receipt data, or null if no items could be extracted
 */
export function parseSefazPage(html: string): ReceiptOcrResult | null {
  const $ = cheerio.load(html);

  // Try extraction strategies in order of reliability
  const items =
    extractFromTable($) ?? extractFromDivs($) ?? extractFromText($);

  if (!items || items.length === 0) return null;

  const merchant = extractMerchant($);
  const extractedTotal = extractTotal($);
  const itemsTotal = items.reduce((sum, item) => sum + item.totalCents, 0);
  const serviceFeePercent = extractServiceFeePercent($);

  return {
    merchant,
    items,
    serviceFeePercent,
    totalCents: extractedTotal > 0 ? extractedTotal : itemsTotal,
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
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      redirect: "follow",
    });

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
