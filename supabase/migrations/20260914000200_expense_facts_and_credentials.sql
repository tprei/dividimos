CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES public.users(id),
  status public.expense_status NOT NULL DEFAULT 'active',
  current_version_no integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  chave_acesso text CHECK (chave_acesso IS NULL OR chave_acesso ~ '^[0-9]{44}$'),
  declined_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  CONSTRAINT expenses_declined_users_valid CHECK (
    cardinality(declined_user_ids) <= 50 AND array_position(declined_user_ids, NULL) IS NULL
  ),
  CONSTRAINT expenses_current_version_positive CHECK (current_version_no >= 1)
);
CREATE INDEX expenses_group_created_idx ON public.expenses (group_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX expenses_creator_chave_active_idx
  ON public.expenses (creator_id, chave_acesso)
  WHERE status = 'active' AND chave_acesso IS NOT NULL;

CREATE TABLE public.expense_versions (
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no >= 1),
  author_id uuid NOT NULL REFERENCES public.users(id),
  occurred_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  merchant_name text CHECK (merchant_name IS NULL OR length(merchant_name) <= 160),
  expense_type public.expense_type NOT NULL,
  total_cents integer NOT NULL CHECK (total_cents BETWEEN 1 AND 99999999),
  service_fee_bps integer NOT NULL DEFAULT 0 CHECK (service_fee_bps BETWEEN 0 AND 10000),
  fixed_fee_cents integer NOT NULL DEFAULT 0 CHECK (fixed_fee_cents BETWEEN 0 AND 99999999),
  payload jsonb NOT NULL,
  change_summary jsonb,
  PRIMARY KEY (expense_id, version_no)
);

ALTER TABLE public.expenses ADD CONSTRAINT expenses_current_version_fk
  FOREIGN KEY (id, current_version_no)
  REFERENCES public.expense_versions(expense_id, version_no)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  claimed_by uuid REFERENCES public.users(id),
  claimed_at timestamptz,
  claimed_version_no integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guests_claim_tuple_valid CHECK (
    (claimed_by IS NULL AND claimed_at IS NULL AND claimed_version_no IS NULL) OR
    (claimed_by IS NOT NULL AND claimed_at IS NOT NULL AND claimed_version_no IS NOT NULL)
  )
);
CREATE INDEX guests_expense_idx ON public.guests (expense_id);

ALTER TABLE public.guests ADD CONSTRAINT guests_claimed_version_fk
  FOREIGN KEY (expense_id, claimed_version_no)
  REFERENCES public.expense_versions(expense_id, version_no)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
