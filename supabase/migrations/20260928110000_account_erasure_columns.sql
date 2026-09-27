SET lock_timeout = '5s';

ALTER TABLE public.users ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.chat_messages ADD COLUMN erased_at timestamptz;
ALTER TABLE public.chat_messages ALTER COLUMN content DROP NOT NULL;
ALTER TABLE public.chat_messages DROP CONSTRAINT chat_messages_content_check;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_erasure_valid CHECK (
  (erased_at IS NULL AND content IS NOT NULL AND length(content) BETWEEN 1 AND 2000)
  OR (erased_at IS NOT NULL AND content IS NULL)
) NOT VALID;
