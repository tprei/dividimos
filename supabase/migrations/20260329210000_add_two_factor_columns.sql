-- Migration: Add 2FA columns to users table
-- Supports phone-based two-factor authentication via Twilio Verify

-- 2FA enabled flag (default false for existing users)
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;

-- Encrypted phone number for 2FA (same AES-256-GCM as pix_key_encrypted)
-- NULL when 2FA is not enrolled
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_phone TEXT;

-- Hash of the verification code (for enrollment flow only, not login verification)
-- Used during the enroll step to validate the code server-side before enabling 2FA
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_code_hash TEXT;

-- Timestamp when the verification code was generated (for expiry checks)
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_code_created_at TIMESTAMPTZ;

-- Index for quick lookup of 2FA-enabled users during auth flow
CREATE INDEX IF NOT EXISTS idx_users_two_factor_enabled
  ON users (id) WHERE two_factor_enabled = true;
