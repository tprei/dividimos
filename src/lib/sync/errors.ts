export const LEDGER_ERROR_CODES = [
  "unauthenticated",
  "not_a_member",
  "group_not_found",
  "invalid_payload",
  "share_total_mismatch",
  "payer_total_mismatch",
  "itemized_total_mismatch",
  "guest_cannot_pay",
  "duplicate_participant",
  "too_many_items",
  "too_many_participants",
  "creator_not_participant",
  "expense_not_found",
  "expense_deleted",
  "expense_not_deleted",
  "stale_version",
  "not_expense_party",
  "invalid_argument",
  "settlement_not_found",
  "settlement_voided",
  "not_party",
  "counterparty_not_member",
  "amount_exceeds_debt",
  "invalid_name",
  "user_not_found",
  "already_member",
  "not_invited",
  "group_has_history",
  "cannot_leave_dm",
  "outstanding_balance",
  "not_creator",
  "invalid_link",
  "handle_taken",
  "invalid_handle",
  "guest_not_found",
  "guest_already_claimed",
  "invalid_token",
  "already_claimed",
  "already_participant",
  "not_owner",
  "charge_not_found",
  "no_debt",
  "nudge_cooldown",
  "invalid_wire",
  "network",
  "unknown",
] as const;

export type LedgerErrorCode = (typeof LEDGER_ERROR_CODES)[number];

const MESSAGES: Record<LedgerErrorCode, string> = {
  unauthenticated: "Sessão expirada. Entre de novo para continuar.",
  not_a_member: "Você não faz parte desse grupo.",
  group_not_found: "Esse grupo não existe mais.",
  invalid_payload: "Algo saiu estranho nessa conta. Confira os dados e tente de novo.",
  share_total_mismatch: "A soma das partes não bate com o total da conta.",
  payer_total_mismatch: "O que todo mundo pagou não bate com o total da conta.",
  itemized_total_mismatch: "A soma dos itens não bate com o total da conta.",
  guest_cannot_pay: "Convidado não pode pagar. Escolha alguém do grupo.",
  duplicate_participant: "Tem gente repetida nessa conta.",
  too_many_items: "Essa conta tem itens demais.",
  too_many_participants: "Essa conta tem participantes demais.",
  creator_not_participant: "Quem criou a conta precisa estar nela.",
  expense_not_found: "Não achamos essa conta.",
  expense_deleted: "Essa conta foi apagada.",
  expense_not_deleted: "Essa conta não está apagada.",
  stale_version: "Alguém editou essa conta enquanto você mexia. Recarregue e tente de novo.",
  not_expense_party: "Você não participa dessa conta.",
  invalid_argument: "Tem dado inválido aí. Confira e tente de novo.",
  settlement_not_found: "Não achamos esse acerto.",
  settlement_voided: "Esse acerto foi cancelado.",
  not_party: "Você não faz parte desse acerto.",
  counterparty_not_member: "A outra pessoa saiu do grupo.",
  amount_exceeds_debt: "Esse valor é maior que a dívida.",
  invalid_name: "Esse nome não vale. Use entre 1 e 80 caracteres.",
  user_not_found: "Não achamos esse usuário.",
  already_member: "Essa pessoa já está no grupo.",
  not_invited: "Essa pessoa não tem convite pendente.",
  group_has_history: "Esse grupo já tem contas ou pagamentos e não pode ser apagado.",
  cannot_leave_dm: "Não dá para sair de uma conversa direta.",
  outstanding_balance: "Ainda tem saldo pendente nesse grupo. Acerte as contas antes de sair.",
  not_creator: "Só quem criou o grupo pode fazer isso.",
  invalid_link: "Esse convite não é mais válido.",
  handle_taken: "Esse @ já está em uso. Tente outro.",
  invalid_handle: "O @ deve ter de 3 a 30 caracteres: letras minúsculas, números ou _.",
  guest_not_found: "Não achamos esse convidado.",
  guest_already_claimed: "Esse convidado já foi vinculado a alguém.",
  invalid_token: "Esse link não é mais válido.",
  already_claimed: "Esse convidado já foi vinculado.",
  already_participant: "Você já participa dessa conta.",
  not_owner: "Essa cobrança não é sua.",
  charge_not_found: "Não achamos essa cobrança.",
  no_debt: "Essa pessoa não te deve nada.",
  nudge_cooldown: "Você já lembrou essa pessoa hoje.",
  invalid_wire: "Recebemos uma resposta estranha do servidor. Tente de novo.",
  network: "Sem conexão. Tente de novo quando a internet voltar.",
  unknown: "Deu ruim aqui. Tente de novo em instantes.",
};

export interface LedgerErrorOptions {
  message?: string;
  cause?: unknown;
}

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;
  override readonly cause?: unknown;

  constructor(code: LedgerErrorCode, options: LedgerErrorOptions = {}) {
    super(options.message ?? MESSAGES[code]);
    this.name = "LedgerError";
    this.code = code;
    this.cause = options.cause;
  }
}

export function codeFromMessage(message: string): LedgerErrorCode {
  if (!/^[a-z_]+$/.test(message)) return "unknown";
  return Object.hasOwn(MESSAGES, message) ? (message as LedgerErrorCode) : "unknown";
}

export function ledgerErrorMessage(error: unknown): string {
  if (error instanceof LedgerError) {
    return MESSAGES[error.code];
  }
  return MESSAGES.unknown;
}
