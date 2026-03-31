export function normalizePhone(rawInput: string): string {
  if (rawInput.trim().startsWith("+")) {
    return `+${rawInput.replace(/\D/g, "")}`;
  }
  const digits = rawInput.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  return `+55${digits}`;
}

export function phoneToTestEmail(phone: string): string {
  return `${phone.replace("+", "")}@phone.pagajaja.local`;
}

export function redirectForProfile(
  profile: { onboarded: boolean } | null,
  safePath: string,
): string {
  if (!profile?.onboarded) {
    return safePath !== "/app"
      ? `/auth/onboard?next=${encodeURIComponent(safePath)}`
      : "/auth/onboard";
  }

  return safePath;
}
