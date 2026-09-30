-- Rows this large can only come from the unvalidated FCM path that preceded
-- the subscription size bound; a legitimate encrypted token is a few hundred
-- bytes. Dropping them lets push_subscriptions_encrypted_size validate.
DELETE FROM public.push_subscriptions WHERE length(subscription_encrypted) > 16384;
