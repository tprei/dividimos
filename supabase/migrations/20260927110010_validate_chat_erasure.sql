SET lock_timeout = '5s';

ALTER TABLE public.chat_messages VALIDATE CONSTRAINT chat_messages_erasure_valid;
