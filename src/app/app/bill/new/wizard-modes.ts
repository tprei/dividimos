import type { ExpenseType } from "@/types";

export type Step =
  | "type"
  | "info"
  | "participants"
  | "items"
  | "split"
  | "payer"
  | "summary";

export interface StepDef {
  key: Step;
  label: string;
}

export const ITEMIZED_STEPS: StepDef[] = [
  { key: "info", label: "Dados" },
  { key: "participants", label: "Pessoas" },
  { key: "items", label: "Itens" },
  { key: "split", label: "Divisão" },
  { key: "payer", label: "Pagamento" },
  { key: "summary", label: "Resumo" },
];


/** `?dm=<userId>&groupId=<id>&type=<expenseType>` quick-charge mode. */
export interface DmMode {
  userId: string;
  groupId: string;
  type: ExpenseType;
}

/** `?groupId=<id>&title=<text>&amount=<cents>` chat-draft mode. */
export interface ChatDraftMode {
  groupId: string;
  title: string;
  amountCents: number;
}

export interface WizardModes {
  dm: DmMode | null;
  chatDraft: ChatDraftMode | null;
  editExpenseId: string | null;
  /** Group suggested by the URL (`?groupId=`) for the participants step. */
  entryGroupId: string | null;
  /** Wizard step requested by the URL (`?step=`) for voice hydration flows. */
  entryStep: string | null;
}

interface ParamReader {
  get(name: string): string | null;
}

export function parseWizardModes(params: ParamReader): WizardModes {
  const dmUserId = params.get("dm");
  const dmGroupId = params.get("groupId");
  const dmTypeParam = params.get("type");
  const dmType: ExpenseType = dmTypeParam === "itemized" ? "itemized" : "single_amount";
  const dm =
    dmUserId && dmGroupId ? { userId: dmUserId, groupId: dmGroupId, type: dmType } : null;

  const draftGroupId = params.get("groupId");
  const draftTitle = params.get("title");
  const draftAmount = params.get("amount");
  let chatDraft: ChatDraftMode | null = null;
  if (!dm && draftGroupId && draftTitle && draftAmount) {
    const amountCents = Number.parseInt(draftAmount, 10);
    if (Number.isFinite(amountCents) && amountCents > 0) {
      chatDraft = { groupId: draftGroupId, title: draftTitle, amountCents };
    }
  }

  return {
    dm,
    chatDraft,
    editExpenseId: params.get("edit"),
    entryGroupId: params.get("groupId"),
    entryStep: params.get("step"),
  };
}
