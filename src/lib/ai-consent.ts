export const CURRENT_AI_CONSENT_VERSION = 1;

export interface AiConsentState {
  aiConsentVersion: number | null;
  aiConsentGrantedAt: string | null;
}

export function hasCurrentAiConsent(
  consent: AiConsentState | null | undefined,
): boolean {
  return consent?.aiConsentVersion === CURRENT_AI_CONSENT_VERSION
    && typeof consent.aiConsentGrantedAt === "string"
    && Number.isFinite(Date.parse(consent.aiConsentGrantedAt));
}
