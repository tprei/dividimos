import Twilio from "twilio";

const isTestMode = process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE === "true";

let _client: Twilio.Twilio | null = null;

function getClient(): Twilio.Twilio {
  if (_client) return _client;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error(
      "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set when phone test mode is disabled"
    );
  }

  _client = Twilio(accountSid, authToken);
  return _client;
}

function getVerifyServiceSid(): string {
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid) {
    throw new Error("TWILIO_VERIFY_SERVICE_SID must be set when phone test mode is disabled");
  }
  return sid;
}

/**
 * Send a verification code to the given phone number via SMS.
 * In test mode, no SMS is sent — any 6-digit code will be accepted by checkVerificationCode.
 */
export async function sendVerificationCode(phone: string): Promise<{ success: boolean }> {
  if (isTestMode) {
    return { success: true };
  }

  const client = getClient();
  const serviceSid = getVerifyServiceSid();

  const verification = await client.verify.v2
    .services(serviceSid)
    .verifications.create({ to: phone, channel: "sms" });

  return { success: verification.status === "pending" };
}

/**
 * Check a verification code for the given phone number.
 * In test mode, any 6-digit code is accepted.
 */
export async function checkVerificationCode(
  phone: string,
  code: string
): Promise<{ success: boolean }> {
  if (isTestMode) {
    const isValid = /^\d{6}$/.test(code);
    return { success: isValid };
  }

  const client = getClient();
  const serviceSid = getVerifyServiceSid();

  const check = await client.verify.v2
    .services(serviceSid)
    .verificationChecks.create({ to: phone, code });

  return { success: check.status === "approved" };
}
