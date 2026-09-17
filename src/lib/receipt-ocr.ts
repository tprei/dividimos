import { GoogleGenAI } from "@google/genai";
import {
  parseExpenseCents,
  parseServiceFeeBasisPoints,
} from "@/lib/expense-money";
import {
  computeExpenseLineTotalCents,
  parseExpenseQuantity,
  unitPriceCentsForLineTotal,
} from "@/lib/expense-quantity";

/** Timeout for the Gemini API call in milliseconds. */
const GEMINI_TIMEOUT_MS = 10_000;

/**
 * A single line item parsed from a receipt.
 * All monetary values are in integer centavos.
 */
export interface ReceiptItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

/** Structured result from receipt OCR. Fees are already integer basis
 * points/cents at this boundary; no float percent survives
 * past this module. */
export interface ReceiptOcrResult {
  merchant: string | null;
  items: ReceiptItem[];
  serviceFeeBasisPoints: number;
  fixedFeesCents: number;
  totalCents: number;
}

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    merchant: {
      type: "string",
      description: "Nome do estabelecimento. Null se não identificado.",
      nullable: true,
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Descrição do item (ex: 'Cerveja Brahma 600ml')",
          },
          quantity: {
            type: "number",
            description: "Quantidade do item",
          },
          unitPriceCents: {
            type: "integer",
            description: "Preço unitário em centavos (R$ 12,50 = 1250)",
          },
          totalCents: {
            type: "integer",
            description:
              "Preço total do item em centavos (quantity * unitPrice)",
          },
        },
        required: ["description", "quantity", "unitPriceCents", "totalCents"],
      },
    },
    serviceFeeBasisPoints: {
      type: "integer",
      description:
        "Taxa de serviço em pontos-base (1 ponto-base = 0,01%; 10% = 1000). 0 se não houver.",
    },
    fixedFeesCents: {
      type: "integer",
      description:
        "Taxas fixas da nota em centavos, como couvert ou entrega. 0 se não houver.",
    },
    totalCents: {
      type: "integer",
      description: "Valor total da nota em centavos",
    },
  },
  required: [
    "merchant",
    "items",
    "serviceFeeBasisPoints",
    "fixedFeesCents",
    "totalCents",
  ],
} as const;

const SYSTEM_PROMPT = `Você é um parser de notas fiscais brasileiras (NFC-e / cupom fiscal).
Extraia os dados estruturados da imagem. Regras:
- Todos os valores monetários devem ser em centavos (inteiro). R$ 12,50 = 1250.
- quantity deve refletir a quantidade real do item.
- unitPriceCents é o preço de UMA unidade em centavos, como impresso na nota.
- totalCents de cada item é o valor total da linha como impresso na nota (última coluna de valor). NÃO multiplique quantity × unitPriceCents — o valor já está multiplicado na nota.
- serviceFeeBasisPoints: se houver "taxa de serviço" ou "serviço" na nota como um percentual explícito, converta para pontos-base (10% = 1000, 12,5% = 1250). Caso contrário, 0. NUNCA calcule o percentual dividindo um valor monetário de taxa pelo subtotal — se só houver um valor em R$ sem percentual impresso, informe 0.
- fixedFeesCents: some todas as taxas fixas impressas separadamente, como couvert ou entrega, em centavos. Se não houver taxa fixa, informe 0. Não inclua a taxa de serviço percentual neste campo.
- totalCents (raiz): valor total da nota fiscal impresso, incluindo taxas. NUNCA calcule somando os itens — se o total da nota não estiver legível, retorne 0.
- Se o texto estiver parcialmente ilegível, omita os itens ou valores ilegíveis em vez de adivinhar.
- Não invente itens que não existem na imagem.`;

/**
 * Calls Gemini Flash-Lite to parse a receipt image into structured data.
 *
 * @param imageBase64 - Base64-encoded image data (no data URI prefix)
 * @param mimeType - MIME type of the image (e.g. "image/jpeg")
 * @param apiKey - Google AI API key
 * @returns Parsed receipt data
 */
export async function parseReceiptImage(
  imageBase64: string,
  mimeType: string,
  apiKey: string,
): Promise<ReceiptOcrResult> {
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType,
              data: imageBase64,
            },
          },
          {
            text: "Extraia os itens e valores desta nota fiscal.",
          },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RECEIPT_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
      temperature: 0,
      httpOptions: { timeout: GEMINI_TIMEOUT_MS },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  const parsed = JSON.parse(text) as {
    merchant: unknown;
    items: unknown;
    serviceFeeBasisPoints: unknown;
    fixedFeesCents: unknown;
    totalCents: unknown;
  };

  const merchant = typeof parsed.merchant === "string" ? parsed.merchant : null;

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items: ReceiptItem[] = [];
  for (const raw of rawItems) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const description = typeof r.description === "string" ? r.description.trim() : "";
    const quantity = parseExpenseQuantity(r.quantity);
    const lineTotal = parseExpenseCents(r.totalCents, "positive");
    if (!description || !quantity.ok || !lineTotal.ok) {
      continue;
    }
    const printedUnit = parseExpenseCents(r.unitPriceCents, "positive");
    const printedLine = printedUnit.ok
      ? computeExpenseLineTotalCents(quantity.value, printedUnit.value)
      : null;
    if (printedUnit.ok && printedLine?.ok && printedLine.value === lineTotal.value) {
      items.push({
        description,
        quantity: r.quantity as number,
        unitPriceCents: printedUnit.value,
        totalCents: lineTotal.value,
      });
      continue;
    }
    // The printed line total is the amount that gets split, so it wins.
    // A unit price that cannot reproduce it is replaced by one that can;
    // when no unit price can, the line becomes one unit at the printed total.
    const derivedUnit = unitPriceCentsForLineTotal(quantity.value as number, lineTotal.value as number);
    if (derivedUnit !== null) {
      items.push({
        description,
        quantity: r.quantity as number,
        unitPriceCents: derivedUnit,
        totalCents: lineTotal.value,
      });
    } else {
      items.push({
        description,
        quantity: 1,
        unitPriceCents: lineTotal.value,
        totalCents: lineTotal.value,
      });
    }
  }

  const serviceFee = parseServiceFeeBasisPoints(
    parsed.serviceFeeBasisPoints ?? 0,
  );
  const fixedFees = parseExpenseCents(parsed.fixedFeesCents ?? 0, "allow");
  const total = parseExpenseCents(parsed.totalCents ?? 0, "allow");
  if (!serviceFee.ok || !fixedFees.ok || !total.ok) {
    throw new Error("Gemini returned invalid receipt money");
  }

  return {
    merchant,
    items,
    serviceFeeBasisPoints: serviceFee.value,
    fixedFeesCents: fixedFees.value,
    totalCents: total.value,
  };
}
