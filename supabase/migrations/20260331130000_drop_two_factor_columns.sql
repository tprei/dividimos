-- Migration: Drop 2FA columns and 'phone' pix key type from users table
-- 2FA via phone/Twilio is removed; auth is Google OAuth only.
-- The 'phone' value is dropped from pix_key_type since the project has no phone auth.

-- Drop the partial index first
DROP INDEX IF EXISTS idx_users_two_factor_enabled;

-- Drop all 2FA columns
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_phone;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_code_hash;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_code_created_at;

-- Remove 'phone' from pix_key_type enum.
-- PostgreSQL doesn't support DROP VALUE, so recreate the type.
ALTER TABLE users ALTER COLUMN pix_key_type DROP DEFAULT;
ALTER TABLE users ALTER COLUMN pix_key_type TYPE text;
DROP TYPE pix_key_type;
CREATE TYPE pix_key_type AS ENUM ('cpf', 'email', 'random');
ALTER TABLE users ALTER COLUMN pix_key_type TYPE pix_key_type USING pix_key_type::pix_key_type;
ALTER TABLE users ALTER COLUMN pix_key_type SET DEFAULT 'email';
