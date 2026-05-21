/** Maximum length of a member-supplied field (handle or name) interpolated into a trusted system prompt. */
const MAX_MEMBER_FIELD_LENGTH = 80;

/** Maximum length of free-text user input forwarded to the LLM as data. */
const MAX_USER_TEXT_LENGTH = 2000;

/** Zero-width and bidirectional formatting characters: U+200B-200F, U+202A-202E, U+2066-2069, U+FEFF. Dropped entirely. */
const REMOVE_CHARS = new RegExp(
  "[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]",
  "g",
);

/** C0/C1 control characters and line/paragraph separators: U+0000-001F, U+007F-009F, U+2028-2029. Replaced with a space. */
const TO_SPACE_CHARS = new RegExp(
  "[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029]",
  "g",
);

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
  return neutralize(value).slice(0, MAX_MEMBER_FIELD_LENGTH);
}

/**
 * Sanitize free-text user input before forwarding it to the LLM as data. Collapses
 * all whitespace to single spaces so the value cannot fabricate prompt structure,
 * drops invisible/bidi characters, and caps the length.
 */
export function sanitizeUserText(value: string): string {
  return neutralize(value).slice(0, MAX_USER_TEXT_LENGTH);
}
