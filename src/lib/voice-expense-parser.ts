import { GoogleGenAI } from "@google/genai";

/** Timeout for the Gemini API call in milliseconds. */
const GEMINI_TIMEOUT_MS = 10_000;

/** A participant mentioned in the voice input, matched to a known member. */
export interface VoiceParticipantMatch {
  /** The name as spoken by the user. */
  spokenName: string;
  /** The matched member's handle, or null if no match found. */
  matchedHandle: string | null;
  /** How confident the match is. */
  confidence: "high" | "medium" | "low";
}

/** A line item parsed from voice input (for itemized expenses). */
export interface VoiceExpenseItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

/** Structured result from voice expense parsing. */
export interface VoiceExpenseResult {
  /** Expense title / description. */
  title: string;
  /** Total amount in centavos. 0 if not mentioned. */
  amountCents: number;
  /** Detected expense type. */
  expenseType: "single_amount" | "itemized";
  /** Line items (only for itemized expenses). */
  items: VoiceExpenseItem[];
  /** Participants mentioned by name. */
  participants: VoiceParticipantMatch[];
  /** Merchant / establishment name, if mentioned. */
  merchantName: string | null;
}

/** A known group member passed as context for name resolution. */
export interface MemberContext {
  handle: string;
  name: string;
}

const VOICE_EXPENSE_SCHEMA = {
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
      description: "Pessoas mencionadas na fala.",
      items: {
        type: "object",
        properties: {
          spokenName: {
            type: "string",
            description: "Nome como falado pelo usuário",
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
    merchantName: {
      type: "string",
      description:
        "Nome do estabelecimento, se mencionado. Null se não mencionado.",
      nullable: true,
    },
  },
  required: [
    "title",
    "amountCents",
    "expenseType",
    "items",
    "participants",
    "merchantName",
  ],
} as const;

function buildSystemPrompt(members?: MemberContext[]): string {
  let prompt = `Você é um parser de despesas por voz para um app de divisão de contas brasileiro.
O usuário vai ditar uma despesa em português. Extraia os dados estruturados. Regras:

- Todos os valores monetários devem ser em centavos (inteiro). R$ 25 = 2500, R$ 12,50 = 1250.
- Converta números por extenso: "vinte e cinco" = 2500, "cem" = 10000, "cento e vinte" = 12000.
- "reais" ou "R$" indica o valor. "e cinquenta" ou "e meio" após um valor indica centavos (ex: "25 e cinquenta" = 2550, "25 e meio" = 2550).
- title: descrição curta da despesa (ex: "Uber", "Pizza", "Mercado"). NÃO inclua nomes de pessoas no título.
- Se apenas um valor total foi mencionado, use expenseType "single_amount" e items vazio.
- Se múltiplos itens com preços foram mencionados (ex: "2 cervejas a 15 e 1 pizza a 40"), use "itemized".
- merchantName: nome do estabelecimento se mencionado (ex: "no iFood", "do Mercado Livre"). Null se não mencionado.
- participants: pessoas mencionadas pelo nome (ex: "com João", "com Maria e Pedro").
- Se o valor não foi mencionado, amountCents deve ser 0.
- Para itemized, totalCents de cada item = quantity × unitPriceCents.`;

  if (members && members.length > 0) {
    const memberList = members
      .map((m) => `  - @${m.handle} (${m.name})`)
      .join("\n");
    prompt += `

Membros conhecidos do grupo:
${memberList}

Quando o usuário mencionar um nome, tente corresponder com um membro acima.
- Correspondência exata ou muito próxima → confidence "high"
- Nome parcial ou apelido plausível → confidence "medium"
- Ambíguo ou sem correspondência → confidence "low", matchedHandle null
- Se dois membros têm nomes parecidos, use confidence "low" para ambos.`;
  } else {
    prompt += `

Não há membros conhecidos. Coloque matchedHandle como null e confidence "low" para todos os participantes.`;
  }

  return prompt;
}

/**
 * Calls Gemini Flash-Lite to parse voice input text into structured expense data.
 *
 * @param text - Transcribed speech text in Portuguese
 * @param apiKey - Google AI API key
 * @param members - Optional list of known group members for name resolution
 * @returns Parsed expense data
 */
export async function parseVoiceExpense(
  text: string,
  apiKey: string,
  members?: MemberContext[],
): Promise<VoiceExpenseResult> {
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Extraia os dados desta despesa ditada: "${text}"`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: buildSystemPrompt(members),
      responseMimeType: "application/json",
      responseSchema: VOICE_EXPENSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
      temperature: 0,
      httpOptions: { timeout: GEMINI_TIMEOUT_MS },
    },
  });

  const responseText = response.text;
  if (!responseText) {
    throw new Error("Gemini returned empty response");
  }

  const parsed = JSON.parse(responseText) as VoiceExpenseResult;

  // Sanitize
  parsed.amountCents = Math.round(Math.max(0, parsed.amountCents ?? 0));
  parsed.title = (parsed.title ?? "").trim();
  parsed.items = Array.isArray(parsed.items) ? parsed.items : [];
  parsed.participants = Array.isArray(parsed.participants)
    ? parsed.participants
    : [];

  // Round item cents
  for (const item of parsed.items) {
    item.unitPriceCents = Math.round(Math.max(0, item.unitPriceCents ?? 0));
    item.totalCents = Math.round(Math.max(0, item.totalCents ?? 0));
    item.quantity = Math.max(0, item.quantity ?? 0);
  }

  // If itemized with items but amountCents is 0, compute from items
  if (
    parsed.expenseType === "itemized" &&
    parsed.items.length > 0 &&
    parsed.amountCents === 0
  ) {
    parsed.amountCents = parsed.items.reduce((sum, i) => sum + i.totalCents, 0);
  }

  return parsed;
}
