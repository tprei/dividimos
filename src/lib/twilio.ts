/**
 * Twilio Verify client for 2FA SMS verification.
 *
 * Stub — full implementation is in a separate task.
 */

export async function sendCode(
  _phone: string,
): Promise<{ success: boolean }> {
  throw new Error("Twilio module not yet implemented");
}

export async function verifyCode(
  _phone: string,
  _code: string,
): Promise<{ valid: boolean }> {
  throw new Error("Twilio module not yet implemented");
}
