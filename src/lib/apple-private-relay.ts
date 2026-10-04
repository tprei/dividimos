const APPLE_PRIVATE_RELAY_DOMAIN = "@privaterelay.appleid.com";

/**
 * Apple's Hide My Email address: it forwards mail to the person, but its local
 * part is random and no bank holds it as a Pix key.
 */
export function isApplePrivateRelayEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(APPLE_PRIVATE_RELAY_DOMAIN);
}
