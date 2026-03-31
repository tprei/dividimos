import { GoogleGenAI } from "@google/genai";
import { sanitizeReceiptResult } from "./receipt-sanitize";

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

/** Structured result from receipt OCR. */
export interface ReceiptOcrResult {
  merchant: string | null;
  items: ReceiptItem[];
  serviceFeePercent: number;
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
    serviceFeePercent: {
      type: "number",
      description:
        "Percentual de taxa de serviço (ex: 10 para 10%). 0 se não houver.",
    },
    totalCents: {
      type: "integer",
      description: "Valor total da nota em centavos",
    },
  },
  required: ["merchant", "items", "serviceFeePercent", "totalCents"],
} as const;

const SYSTEM_PROMPT = `Você é um parser de notas fiscais brasileiras (NFC-e / cupom fiscal).
Extraia os dados estruturados da imagem. Regras:
- Todos os valores monetários devem ser em centavos (inteiro). R$ 12,50 = 1250.
- quantity deve refletir a quantidade real do item.
- unitPriceCents é o preço de UMA unidade em centavos.
- totalCents de cada item é o valor total da linha como impresso na nota (última coluna de valor). NÃO multiplique quantity × unitPriceCents — o valor já está multiplicado na nota.
- unitPriceCents é o preço de UMA unidade. Se a nota mostra apenas qty e total, calcule unitPriceCents = totalCents / quantity.
- serviceFeePercent: se houver "taxa de serviço" ou "serviço" na nota, informe o percentual. Caso contrário, 0.
- totalCents (raiz): valor total da nota fiscal, incluindo taxas.
- Se o texto estiver parcialmente ilegível, faça o melhor esforço.
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

  const parsed = JSON.parse(text) as ReceiptOcrResult;
  parsed.totalCents = Math.round(parsed.totalCents ?? 0);
  parsed.serviceFeePercent = Math.max(0, parsed.serviceFeePercent ?? 0);
  parsed.items = Array.isArray(parsed.items) ? parsed.items : [];

  return sanitizeReceiptResult(parsed);
}
