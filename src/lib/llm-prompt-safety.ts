/** Maximum length of a member-supplied field (handle or name) interpolated into a trusted system prompt. */
const MAX_MEMBER_FIELD_LENGTH = 80;

/** Maximum length of free-text user input forwarded to the LLM as data. */
const MAX_USER_TEXT_LENGTH = 2000;

/**
 * Unicode format characters (category Cf): zero-width spaces/joiners, bidi marks,
 * embeddings, overrides and isolates, the BOM, and the tag block (U+E0000-E007F).
 * Dropped entirely — these are invisible and can smuggle hidden instructions.
 */
const REMOVE_CHARS = /\p{Cf}/gu;

/**
 * Control characters (category Cc, covers C0/C1 incl. newline, tab, NEL) and
 * line/paragraph separators. Replaced with a space so the value cannot fabricate
 * new prompt lines while still keeping word boundaries.
 */
const TO_SPACE_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/** Cap to `max` UTF-16 code units without splitting a trailing surrogate pair. */
function capLength(value: string, max: number): string {
  if (value.length <= max) return value;
  const sliced = value.slice(0, max);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  // A lone high surrogate at the end would serialize to invalid JSON.
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    return sliced.slice(0, -1);
  }
  return sliced;
}

function neutralize(value: string): string {
  return value
    .replace(REMOVE_CHARS, "")
    .replace(TO_SPACE_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sanitize a member-supplied field (handle or name) before interpolating it into a
 * trusted system prompt. Strips control, bidi, and zero-width characters that could
 * fabricate new prompt lines or hide injected instructions, then caps the length.
 */
export function sanitizeMemberField(value: string): string {
  return capLength(neutralize(value), MAX_MEMBER_FIELD_LENGTH);
}

/**
 * Sanitize free-text user input before forwarding it to the LLM as data. Collapses
 * all whitespace to single spaces so the value cannot fabricate prompt structure,
 * drops invisible/bidi characters, and caps the length.
 */
export function sanitizeUserText(value: string): string {
  return capLength(neutralize(value), MAX_USER_TEXT_LENGTH);
}

/**
 * Serializes members as JSON for the untrusted data block of a user message.
 * Values are sanitized and JSON-encoded, so a display name cannot break out of
 * the block or fabricate prompt structure. The system prompt never sees these
 * values, only the block's meaning.
 */
export function memberDataBlock(
  members: readonly { handle: string; name: string }[] | undefined,
): string {
  return JSON.stringify(
    (members ?? []).map((member) => ({
      handle: sanitizeMemberField(member.handle),
      name: sanitizeMemberField(member.name),
    })),
  );
}
