/** What went wrong activating push on this device, and whether retrying can help. */
export type PushFailureCode =
  | "denied"
  | "unsupported"
  | "config"
  | "worker"
  | "server"
  | "native";

export class PushFailure extends Error {
  readonly code: PushFailureCode;
  readonly retryable: boolean;

  constructor(code: PushFailureCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "PushFailure";
    this.code = code;
    // A denied permission and a missing key need a human to act elsewhere;
    // everything else is worth pressing the button again.
    this.retryable = code !== "denied" && code !== "unsupported" && code !== "config";
  }
}

const MESSAGES: Record<PushFailureCode, string> = {
  denied: "As notificações estão bloqueadas nas configurações do navegador.",
  unsupported: "As notificações não estão disponíveis neste dispositivo.",
  config: "As notificações ainda não foram configuradas por aqui.",
  worker: "Não deu para preparar as notificações neste dispositivo.",
  server: "Não deu para salvar suas notificações.",
  native: "Não deu para ativar as notificações neste dispositivo.",
};

export function pushFailureMessage(error: unknown): string {
  if (error instanceof PushFailure) return MESSAGES[error.code];
  return MESSAGES.server;
}
