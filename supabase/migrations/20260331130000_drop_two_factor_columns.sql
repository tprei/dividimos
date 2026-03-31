-- Migration: Drop 2FA columns from users table
-- 2FA via phone/Twilio is being removed; auth is Google OAuth only.
-- The pix_key_type enum keeps 'phone' for backward compatibility with existing rows.

-- Drop the partial index first
DROP INDEX IF EXISTS idx_users_two_factor_enabled;

-- Drop all 2FA columns
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_phone;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_code_hash;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_code_created_at;
