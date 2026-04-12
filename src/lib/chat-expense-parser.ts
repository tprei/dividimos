import { GoogleGenAI } from "@google/genai";
import type { MemberContext } from "./voice-expense-parser";

export type { MemberContext } from "./voice-expense-parser";

/** Timeout for the Gemini API call in milliseconds. */
const GEMINI_TIMEOUT_MS = 10_000;

/** A participant mentioned in the chat message, matched to a known member. */
export interface ChatParticipantMatch {
  /** The name as typed by the user. */
  spokenName: string;
  /** The matched member's handle, or null if no match found. */
  matchedHandle: string | null;
  /** How confident the match is. */
  confidence: "high" | "medium" | "low";
}

/** A line item parsed from chat input (for itemized expenses). */
export interface ChatExpenseItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

/** Structured result from chat expense parsing. */
export interface ChatExpenseResult {
  /** Expense title / description. */
  title: string;
  /** Total amount in centavos. 0 if not mentioned. */
  amountCents: number;
  /** Detected expense type. */
  expenseType: "single_amount" | "itemized";
  /** How to split the expense. */
  splitType: "equal" | "custom";
  /** Line items (only for itemized expenses). */
  items: ChatExpenseItem[];
  /** Participants mentioned by name. */
  participants: ChatParticipantMatch[];
  /** Handle of the person who paid, or null if ambiguous/not mentioned. */
  payerHandle: string | null;
  /** Merchant / establishment name, if mentioned. */
  merchantName: string | null;
  /** Overall confidence in the parse result. */
  confidence: "high" | "medium" | "low";
}

const CHAT_EXPENSE_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        "Título curto da despesa (ex: 'Uber', 'Pizza', 'Mercado'). Não inclua nomes de pessoas.",
    },
    amountCents: {
      type: "integer",
      description:
        "Valor total em centavos. R$ 25,00 = 2500. R$ 12,50 = 1250. 0 se não mencionado.",
    },
    expenseType: {
      type: "string",
      enum: ["single_amount", "itemized"],
      description:
        "single_amount para um valor único, itemized se múltiplos itens foram mencionados.",
    },
    splitType: {
      type: "string",
      enum: ["equal", "custom"],
      description:
        "equal se dividido igualmente ou não especificado, custom se proporções diferentes foram mencionadas.",
    },
    items: {
      type: "array",
      description:
        "Itens individuais (só para itemized). Vazio para single_amount.",
      items: {
        type: "object",
        properties: {
          description: { type: "string", description: "Descrição do item" },
          quantity: { type: "number", description: "Quantidade" },
          unitPriceCents: {
            type: "integer",
            description: "Preço unitário em centavos",
          },
          totalCents: {
            type: "integer",
            description: "Preço total em centavos",
          },
        },
        required: ["description", "quantity", "unitPriceCents", "totalCents"],
      },
    },
    participants: {
      type: "array",
      description: "Pessoas mencionadas na mensagem.",
      items: {
        type: "object",
        properties: {
          spokenName: {
            type: "string",
            description: "Nome como escrito pelo usuário",
          },
          matchedHandle: {
            type: "string",
            description:
              "Handle (@) do membro correspondente, ou null se não encontrado.",
            nullable: true,
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Confiança na correspondência do nome com o membro.",
          },
        },
        required: ["spokenName", "matchedHandle", "confidence"],
      },
    },
    payerHandle: {
      type: "string",
      description:
        "Handle de quem pagou. Null se ambíguo ou não mencionado.",
      nullable: true,
    },
    merchantName: {
      type: "string",
      description:
        "Nome do estabelecimento, se mencionado. Null se não mencionado.",
      nullable: true,
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Confiança geral no parse. high: valor e título claros. medium: alguma ambiguidade. low: muito incerto.",
    },
  },
  required: [
    "title",
    "amountCents",
    "expenseType",
    "splitType",
    "items",
    "participants",
    "payerHandle",
    "merchantName",
    "confidence",
  ],
} as const;

function buildSystemPrompt(members?: MemberContext[]): string {
  let prompt = `Você é um parser de despesas para um chat de divisão de contas brasileiro.
O usuário vai digitar uma mensagem curta em português descrevendo uma despesa. Extraia os dados estruturados. Regras:

- Todos os valores monetários devem ser em centavos (inteiro). R$ 25 = 2500, R$ 12,50 = 1250.
- "reais", "R$", "conto(s)", "pila(s)", "real" indicam valor.
- Números por extenso: "vinte e cinco" = 2500, "cem" = 10000, "cento e vinte" = 12000.
- "e cinquenta" ou "e meio" após um valor indica centavos (ex: "25 e cinquenta" = 2550, "25 e meio" = 2550).
- title: descrição curta da despesa (ex: "Uber", "Pizza", "Mercado"). NÃO inclua nomes de pessoas no título.
- Se apenas um valor total foi mencionado, use expenseType "single_amount" e items vazio.
- Se múltiplos itens com preços foram mencionados, use "itemized".
- splitType: "equal" se dividido igualmente ou não especificado. "custom" se proporções diferentes foram mencionadas (ex: "eu paguei 60 e ele 40").
- payerHandle: handle de quem pagou. Identifique de frases como "eu paguei", "paguei eu", "foi eu", "eu que paguei", "conta minha". Se o remetente diz "eu paguei", payerHandle é "SELF" (será resolvido pelo caller). Null se ambíguo.
- merchantName: nome do estabelecimento se mencionado (ex: "no iFood", "do Mercado Livre"). Null se não mencionado.
- participants: pessoas mencionadas pelo nome.
- Se o valor não foi mencionado, amountCents deve ser 0.
- Para itemized, totalCents de cada item = quantity × unitPriceCents.
- confidence: "high" se título e valor são claros. "medium" se algum dado está implícito. "low" se a mensagem é muito vaga.

Exemplos de mensagens comuns:
- "pegamos uber 25 reais eu paguei" → title: "Uber", amountCents: 2500, payerHandle: "SELF", confidence: "high"
- "pizza 60 conto rachei com maria" → title: "Pizza", amountCents: 6000, splitType: "equal", confidence: "high"
- "almoco" → title: "Almoço", amountCents: 0, confidence: "low"
- "2 cervejas 15 e 1 batata 20 no bar do ze" → itemized, merchantName: "Bar do Zé", confidence: "high"`;

  if (members && members.length > 0) {
    const memberList = members
      .map((m) => `  - @${m.handle} (${m.name})`)
      .join("\n");
    prompt += `

Membros conhecidos da conversa:
${memberList}

Quando o usuário mencionar um nome, tente corresponder com um membro acima.
- Correspondência exata ou muito próxima → confidence "high"
- Nome parcial ou apelido plausível → confidence "medium"
- Ambíguo ou sem correspondência → confidence "low", matchedHandle null
- Se dois membros têm nomes parecidos, use confidence "low" para ambos.
- payerHandle deve ser o handle do membro que pagou, ou "SELF" se o remetente pagou, ou null se ambíguo.`;
  } else {
    prompt += `

Não há membros conhecidos. Coloque matchedHandle como null e confidence "low" para todos os participantes.`;
  }

  return prompt;
}

/**
 * Calls Gemini Flash-Lite to parse a chat message into structured expense data.
 *
 * @param text - Chat message text in Portuguese
 * @param apiKey - Google AI API key
 * @param members - Optional list of known conversation members for name resolution
 * @returns Parsed expense data with confidence score
 */
export async function parseChatExpense(
  text: string,
  apiKey: string,
  members?: MemberContext[],
): Promise<ChatExpenseResult> {
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Extraia os dados desta despesa digitada no chat: "${text}"`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: buildSystemPrompt(members),
      responseMimeType: "application/json",
      responseSchema: CHAT_EXPENSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
      temperature: 0,
      httpOptions: { timeout: GEMINI_TIMEOUT_MS },
    },
  });

  const responseText = response.text;
  if (!responseText) {
    throw new Error("Gemini returned empty response");
  }

  const parsed = JSON.parse(responseText) as ChatExpenseResult;

  return sanitizeChatResult(parsed);
}

/** Sanitize and normalize the raw Gemini response. Exported for testing. */
export function sanitizeChatResult(parsed: ChatExpenseResult): ChatExpenseResult {
  parsed.amountCents = Math.round(Math.max(0, parsed.amountCents ?? 0));
  parsed.title = (parsed.title ?? "").trim();
  parsed.items = Array.isArray(parsed.items) ? parsed.items : [];
  parsed.participants = Array.isArray(parsed.participants)
    ? parsed.participants
    : [];
  parsed.payerHandle = parsed.payerHandle ?? null;
  parsed.merchantName = parsed.merchantName ?? null;
  parsed.confidence = parsed.confidence ?? "low";
  parsed.splitType = parsed.splitType ?? "equal";

  for (const item of parsed.items) {
    item.unitPriceCents = Math.round(Math.max(0, item.unitPriceCents ?? 0));
    item.totalCents = Math.round(Math.max(0, item.totalCents ?? 0));
    item.quantity = Math.max(0, item.quantity ?? 0);
  }

  if (
    parsed.expenseType === "itemized" &&
    parsed.items.length > 0 &&
    parsed.amountCents === 0
  ) {
    parsed.amountCents = parsed.items.reduce((sum, i) => sum + i.totalCents, 0);
  }

  return parsed;
}
