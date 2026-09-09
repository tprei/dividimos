import type { ExpenseType } from "@/types";

export type Step =
  | "type"
  | "info"
  | "participants"
  | "items"
  | "split"
  | "payer"
  | "summary";

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
  expenseType: ExpenseType;
  participantIds?: string[];
  payerId?: string;
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
function parseValidatedActorIds(
  participantIdsParam: string | null,
  payerIdParam: string | null,
): { participantIds: string[]; payerId: string } | null {
  if (participantIdsParam === null && payerIdParam === null) return null;
  if (!participantIdsParam || !payerIdParam) return null;
  const participantIds = participantIdsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (
    participantIds.length !== 2 ||
    new Set(participantIds).size !== participantIds.length ||
    !participantIds.includes(payerIdParam)
  ) {
    return null;
  }
  return { participantIds, payerId: payerIdParam };
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
  const draftTypeParam = params.get("type");
  const draftExpenseType: ExpenseType = draftTypeParam === "itemized" ? "itemized" : "single_amount";
  const participantIdsParam = params.get("participantIds");
  const payerIdParam = params.get("payerId");
  const actorIds =
    participantIdsParam !== null || payerIdParam !== null
      ? parseValidatedActorIds(participantIdsParam, payerIdParam)
      : null;
  const actorParamsValid =
    participantIdsParam === null && payerIdParam === null ? true : actorIds !== null;
  let chatDraft: ChatDraftMode | null = null;
  if (!dm && draftGroupId && draftTitle && draftAmount && actorParamsValid) {
    const amountCents = Number.parseInt(draftAmount, 10);
    if (Number.isFinite(amountCents) && amountCents > 0) {
      chatDraft = {
        groupId: draftGroupId,
        title: draftTitle,
        amountCents,
        expenseType: draftExpenseType,
        ...(actorIds ?? {}),
      };
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
