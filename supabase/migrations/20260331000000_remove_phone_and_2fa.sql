-- Step 1: Clear pix data for phone-type keys (no real users exist)
UPDATE users
  SET pix_key_type = 'email',
      pix_key_hint = '',
      pix_key_encrypted = ''
  WHERE pix_key_type = 'phone';

-- Step 2: Drop 2FA columns
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_phone;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_code_hash;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_code_created_at;

-- Step 3: Drop the partial index (created in 20260329210000)
DROP INDEX IF EXISTS idx_users_two_factor_enabled;

-- Step 4: Drop the phone column from users
ALTER TABLE users DROP COLUMN IF EXISTS phone;

-- Step 5: Recreate pix_key_type enum without 'phone'
-- PostgreSQL requires dropping and recreating the type.
-- Drop the default first (it holds a reference to the enum type), convert
-- the column to text, drop the enum with CASCADE to release any remaining
-- dependents (e.g. function signatures), then recreate and cast back.
ALTER TABLE users ALTER COLUMN pix_key_type DROP DEFAULT;
ALTER TABLE users ALTER COLUMN pix_key_type TYPE TEXT;
DROP TYPE IF EXISTS pix_key_type CASCADE;
CREATE TYPE pix_key_type AS ENUM ('cpf', 'email', 'random');
ALTER TABLE users ALTER COLUMN pix_key_type TYPE pix_key_type
  USING pix_key_type::pix_key_type;
ALTER TABLE users ALTER COLUMN pix_key_type SET DEFAULT 'email';
