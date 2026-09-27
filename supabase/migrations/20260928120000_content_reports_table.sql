-- Content reports: service-role-only abuse evidence with dedup and operator resolution.
SET lock_timeout = '5s';

CREATE TYPE public.report_reason AS ENUM (
  'assedio',
  'discurso_de_odio',
  'ameaca_ou_violencia',
  'conteudo_sexual',
  'golpe_ou_spam',
  'outro'
);

CREATE TYPE public.report_status AS ENUM ('open', 'resolved', 'dismissed');

CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  message_id uuid,
  group_id uuid,
  reason public.report_reason NOT NULL,
  details text,
  message_snapshot text,
  status public.report_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  resolved_at timestamptz,
  resolution_note text
);

ALTER TABLE public.reports
  ADD CONSTRAINT reports_reporter_fk
    FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT reports_target_fk
    FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT reports_group_fk
    FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT reports_distinct_users
    CHECK (reporter_id <> target_user_id) NOT VALID,
  ADD CONSTRAINT reports_details_bounds
    CHECK (details IS NULL OR length(details) BETWEEN 1 AND 1000) NOT VALID,
  ADD CONSTRAINT reports_snapshot_bounds
    CHECK (message_snapshot IS NULL OR length(message_snapshot) <= 2000) NOT VALID,
  ADD CONSTRAINT reports_source_context
    CHECK (message_id IS NOT NULL OR (group_id IS NULL AND message_snapshot IS NULL)) NOT VALID,
  ADD CONSTRAINT reports_resolution_valid
    CHECK (
      (status = 'open' AND resolved_at IS NULL AND resolution_note IS NULL)
      OR
      (status IN ('resolved', 'dismissed') AND resolved_at IS NOT NULL
       AND resolution_note IS NOT NULL AND length(btrim(resolution_note)) BETWEEN 1 AND 2000)
    ) NOT VALID;

ALTER TABLE public.reports VALIDATE CONSTRAINT reports_reporter_fk;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_target_fk;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_group_fk;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_distinct_users;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_details_bounds;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_snapshot_bounds;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_source_context;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_resolution_valid;

CREATE UNIQUE INDEX reports_reporter_message_key
  ON public.reports (reporter_id, message_id) WHERE message_id IS NOT NULL AND status = 'open';
CREATE UNIQUE INDEX reports_reporter_target_key
  ON public.reports (reporter_id, target_user_id) WHERE message_id IS NULL AND status = 'open';
CREATE INDEX reports_review_queue_idx ON public.reports (status, created_at);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reports TO service_role;
