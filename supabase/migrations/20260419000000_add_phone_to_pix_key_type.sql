-- Re-add 'phone' to the pix_key_type enum.
-- The value was removed in 20260331000000_remove_phone_and_2fa.sql when phone-based
-- auth and 2FA were dropped, but Pix still supports phone as a key type and users
-- need to be able to register one.
ALTER TYPE pix_key_type ADD VALUE IF NOT EXISTS 'phone';
