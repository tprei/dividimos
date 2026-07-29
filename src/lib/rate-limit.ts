import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";

export type RateLimitBucket =
  | "users.lookup"
  | "pix.generate"
  | "pix.generate-self"
  | "voice.parse"
  | "chat.parse"
  | "receipt.ocr"
  | "receipt.sefaz"
  | "push.send"
  | "push.send-pair";

export interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
}

const CONFIGS: Record<RateLimitBucket, RateLimitConfig> = {
  "users.lookup":       { limit: 30,  windowSeconds: 60 },
  "pix.generate":       { limit: 60,  windowSeconds: 60 },
  "pix.generate-self":  { limit: 60,  windowSeconds: 60 },
  "voice.parse":        { limit: 30,  windowSeconds: 60 },
  "chat.parse":         { limit: 30,  windowSeconds: 60 },
  "receipt.ocr":        { limit: 30,  windowSeconds: 60 },
  "receipt.sefaz":      { limit: 10,  windowSeconds: 60 },
  "push.send":          { limit: 60,  windowSeconds: 60 },
  "push.send-pair":     { limit: 5,   windowSeconds: 60 },
};

const MAX_SUBJECT_BYTES = 512;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isBypassActive(): boolean {
  return (
    process.env.RATE_LIMIT_DISABLED === "1" &&
    process.env.NODE_ENV === "test" &&
    process.env.VITEST === "true"
  );
}

if (
  process.env.RATE_LIMIT_DISABLED === "1" &&
  process.env.NODE_ENV !== "production"
) {
  console.warn(
    "[rate-limit] RATE_LIMIT_DISABLED=1 is set. It only takes effect under " +
      "NODE_ENV=test with the Vitest runner; every other server (including " +
      "a NODE_ENV=test synthetic/staging server) still enforces limits. " +
      "NEVER set this in production.",
  );
}

/**
 * Spend one token from `bucket` for `subject` (the authenticated user ID).
 *
 * Resolves on success. Throws `AppError("RATE_LIMIT_EXCEEDED", ...)` when the
 * bucket is saturated for this window, or `AppError("RATE_LIMIT_UNAVAILABLE",
 * ...)` when the limiter infrastructure itself cannot be trusted to have
 * made a decision (unknown bucket, invalid subject, RPC/transport failure,
 * or any non-boolean RPC result). Callers must fail closed on the
 * unavailable case rather than allow the request through.
 */
export async function enforceRateLimit(
  bucket: RateLimitBucket,
  subject: string,
): Promise<void> {
  const config = CONFIGS[bucket];
  if (!config) {
    throw new AppError(
      "RATE_LIMIT_UNAVAILABLE",
      "Não foi possível verificar o limite de requisições.",
    );
  }

  if (
    typeof subject !== "string" ||
    subject.trim().length === 0 ||
    byteLength(subject) > MAX_SUBJECT_BYTES
  ) {
    throw new AppError(
      "RATE_LIMIT_UNAVAILABLE",
      "Não foi possível verificar o limite de requisições.",
    );
  }

  if (isBypassActive()) return;

  let data: unknown;
  try {
    const admin = createAdminClient();
    const result = await admin.rpc("increment_rate_limit", {
      p_bucket:         bucket,
      p_subject:        subject,
      p_limit:          config.limit,
      p_window_seconds: config.windowSeconds,
    });

    if (result.error) {
      console.error(
        `[rate-limit] increment_rate_limit RPC error for bucket=${bucket}:`,
        result.error.message,
      );
      throw new AppError(
        "RATE_LIMIT_UNAVAILABLE",
        "Não foi possível verificar o limite de requisições.",
      );
    }

    data = result.data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error(
      `[rate-limit] increment_rate_limit call failed for bucket=${bucket}:`,
      error,
    );
    throw new AppError(
      "RATE_LIMIT_UNAVAILABLE",
      "Não foi possível verificar o limite de requisições.",
    );
  }

  if (data === true) return;

  if (data === false) {
    throw new AppError(
      "RATE_LIMIT_EXCEEDED",
      "Muitas requisições. Tente novamente em alguns segundos.",
    );
  }

  console.error(
    `[rate-limit] increment_rate_limit returned a non-boolean result for bucket=${bucket}`,
  );
  throw new AppError(
    "RATE_LIMIT_UNAVAILABLE",
    "Não foi possível verificar o limite de requisições.",
  );
}
