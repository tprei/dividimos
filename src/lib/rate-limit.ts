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

const BYPASS =
  process.env.RATE_LIMIT_DISABLED === "1" &&
  process.env.NODE_ENV !== "production";

if (BYPASS) {
  console.warn(
    "[rate-limit] RATE_LIMIT_DISABLED=1 — rate limiting is OFF. " +
      "This is for integration tests only. NEVER set this in production.",
  );
}

export async function enforceRateLimit(
  bucket: RateLimitBucket,
  subject: string,
): Promise<void> {
  if (BYPASS) return;

  const config = CONFIGS[bucket];
  const admin = createAdminClient();

  const { error } = await admin.rpc("increment_rate_limit", {
    p_bucket:         bucket,
    p_subject:        subject,
    p_limit:          config.limit,
    p_window_seconds: config.windowSeconds,
  });

  if (!error) return;

  if (error.message.includes("rate_limited")) {
    throw new AppError("RATE_LIMIT_EXCEEDED", "Muitas requisições. Tente novamente em alguns segundos.", {
      statusCode: 429,
    });
  }

  throw new AppError("INTERNAL_ERROR", `Rate-limit RPC failed: ${error.message}`);
}
