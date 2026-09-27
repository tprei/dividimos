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
  "duplicate_receipt",
  "settlement_not_found",
  "settlement_voided",
  "not_party",
  "counterparty_not_member",
  "amount_exceeds_debt",
  "invalid_name",
  "user_not_found",
  "already_member",
  "not_invited",
  "invitation_not_accepted",
  "group_has_history",
  "cannot_leave_dm",
  "outstanding_balance",
  "not_creator",
  "member_excluded",
  "invalid_link",
  "handle_taken",
  "invalid_handle",
  "guest_not_found",
  "guest_already_claimed",
  "invalid_token",
  "already_claimed",
  "room_closed",
  "room_incomplete",
  "item_unavailable",
  "room_cancelled",
  "room_host_required",
  "room_not_found",
  "already_participant",
  "not_owner",
  "charge_not_found",
  "charge_already_received",
  "charge_cancelled",
  "no_debt",
  "nudge_cooldown",
  "invalid_notification_preferences",
  "invalid_wire",
  "network",
  "unknown",
] as const;

export type LedgerErrorCode = (typeof LEDGER_ERROR_CODES)[number];

const MESSAGES: Record<LedgerErrorCode, string> = {
  unauthenticated: "Sua sessão expirou. É preciso entrar de novo.",
  not_a_member: "Você não faz parte desse grupo.",
  group_not_found: "Esse grupo não existe mais.",
  invalid_payload: "Alguns dados dessa conta estão inválidos.",
  share_total_mismatch: "A soma das partes não bate com o total da conta.",
  payer_total_mismatch: "A soma dos valores pagos não bate com o total da conta.",
  itemized_total_mismatch: "A soma dos itens não bate com o total da conta.",
  guest_cannot_pay: "Só quem tem conta no Dividimos pode ser escolhido como pagador.",
  duplicate_participant: "Tem gente repetida nessa conta.",
  too_many_items: "Essa conta tem itens demais.",
  too_many_participants: "Essa conta tem participantes demais.",
  creator_not_participant: "Quem criou a conta precisa estar nela.",
  expense_not_found: "Não achamos essa conta.",
  expense_deleted: "Essa conta foi apagada.",
  expense_not_deleted: "Essa conta não está apagada.",
  stale_version: "Essa conta mudou durante a edição. É preciso recarregar antes de salvar.",
  not_expense_party: "Você não participa dessa conta.",
  invalid_argument: "Alguns dados estão inválidos.",
  duplicate_receipt: "Essa nota já foi registrada por você.",
  settlement_not_found: "Não achamos esse pagamento.",
  settlement_voided: "Esse pagamento foi desfeito.",
  not_party: "Você não faz parte desse pagamento.",
  counterparty_not_member: "A outra pessoa não está no grupo.",
  amount_exceeds_debt: "Esse valor é maior que a dívida.",
  invalid_name: "O nome precisa ter de 1 a 80 caracteres.",
  user_not_found: "Não achamos esse usuário.",
  already_member: "Essa pessoa já está no grupo.",
  not_invited: "Essa pessoa não tem convite pendente.",
  invitation_not_accepted: "Alguém recusou o convite e ainda não entrou no grupo.",
  group_has_history: "Esse grupo já tem contas ou pagamentos e não pode ser apagado.",
  cannot_leave_dm: "Não dá para sair de uma conversa direta.",
  outstanding_balance: "Ainda tem saldo pendente nesse grupo. Para sair, o saldo precisa estar em dia.",
  not_creator: "Só quem criou o grupo pode fazer isso.",
  member_excluded: "Essa pessoa foi removida do grupo.",
  invalid_link: "Esse convite não é mais válido.",
  handle_taken: "Esse @ já está em uso.",
  invalid_handle: "O @ deve ter de 3 a 30 caracteres: letras minúsculas, números ou _.",
  guest_not_found: "Não achamos esse convidado.",
  guest_already_claimed: "Esse convidado já foi vinculado a alguém.",
  invalid_token: "Esse link não é mais válido.",
  already_claimed: "Esse convidado já foi vinculado.",
  room_closed: "A escolha de itens já foi encerrada.",
  room_incomplete: "Ainda há itens sem dividir.",
  item_unavailable: "Essa quantidade não está mais disponível.",
  room_cancelled: "Essa sala foi cancelada.",
  room_host_required: "Só quem criou a sala pode fazer isso.",
  room_not_found: "Não achamos essa sala.",
  already_participant: "Você já participa dessa conta.",
  not_owner: "Essa cobrança não é sua.",
  charge_not_found: "Não achamos essa cobrança.",
  charge_already_received: "Essa cobrança já foi recebida.",
  charge_cancelled: "Essa cobrança foi cancelada.",
  no_debt: "Essa pessoa não te deve nada.",
  nudge_cooldown: "Você já lembrou essa pessoa hoje.",
  invalid_notification_preferences: "Não deu para salvar suas preferências de notificação.",
  invalid_wire: "Não deu para ler a resposta do servidor.",
  network: "Sem conexão. Você pode tentar de novo quando a internet voltar.",
  unknown: "Algo deu errado. Você pode tentar de novo.",
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
