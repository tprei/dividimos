# Production readiness plan

**Date:** 2026-03-23
**Status:** Draft — awaiting approval before implementation

## Summary

Transform Pixwise from a client-side prototype into a production-ready, user-centric bill-splitting platform. The work spans seven workstreams: schema evolution, Google OAuth, Pix key encryption, user/participant model, groups with mutual confirmation, user-scoped views, and a public demo page.

### Design decisions (confirmed)

| Decision | Choice |
|---|---|
| Pix key storage | Server-side AES-256-GCM encryption + `pix_key_hint` column for masked display |
| QR code generation | Server-side API route — raw key never reaches the client |
| Handles | Auto-generated from email local part on signup, editable only during onboarding |
| Phone field | Optional (Google provides email) |
| Demo | Public, no auth — static settlement showcase |
| Groups | Persisted in Supabase, not localStorage |
| User discovery | No search. Exact @handle entry only. Groups require mutual confirmation |

---

## Workstream 1: Database schema evolution

### New migration: `20260324000000_users_auth_groups.sql`

**Users table changes:**

```sql
-- Make phone optional, add email + handle
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ADD COLUMN email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN handle TEXT UNIQUE;
ALTER TABLE users ADD COLUMN pix_key_hint TEXT NOT NULL DEFAULT '';

-- Rename pix_key to pix_key_encrypted for clarity
ALTER TABLE users RENAME COLUMN pix_key TO pix_key_encrypted;

-- Constraints
ALTER TABLE users ADD CONSTRAINT handle_format
  CHECK (handle ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$');
ALTER TABLE users ADD CONSTRAINT handle_length
  CHECK (char_length(handle) >= 3 AND char_length(handle) <= 20);

-- Reference auth.users for Supabase Auth integration
ALTER TABLE users ADD CONSTRAINT users_auth_fk
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
```

**Handle format:** `^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$` — lowercase alphanumeric, dots, underscores. 3-20 chars. Must start and end with alphanumeric.

**New tables:**

```sql
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE group_member_status AS ENUM ('invited', 'accepted');

CREATE TABLE group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status group_member_status NOT NULL DEFAULT 'invited',
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_groups_creator ON groups(creator_id);
CREATE INDEX idx_group_members_user ON group_members(user_id);
CREATE INDEX idx_group_members_status ON group_members(status);
```

**Auto-create profile trigger (Supabase Auth pattern):**

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SET search_path = ''
AS $$
DECLARE
  generated_handle TEXT;
  email_local TEXT;
  suffix INT := 0;
BEGIN
  -- Extract local part of email, sanitize for handle format
  email_local := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9._]', '', 'g'));
  IF char_length(email_local) < 3 THEN
    email_local := email_local || 'user';
  END IF;
  IF char_length(email_local) > 20 THEN
    email_local := left(email_local, 20);
  END IF;

  generated_handle := email_local;

  -- Ensure uniqueness
  WHILE EXISTS (SELECT 1 FROM public.users WHERE handle = generated_handle) LOOP
    suffix := suffix + 1;
    generated_handle := left(email_local, 20 - char_length(suffix::TEXT)) || suffix::TEXT;
  END LOOP;

  INSERT INTO public.users (id, email, handle, name, avatar_url, pix_key_encrypted, pix_key_hint, pix_key_type)
  VALUES (
    NEW.id,
    NEW.email,
    generated_handle,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    '',  -- Empty until onboarding completes
    '',
    'email'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

**RLS policies for new tables:**

```sql
-- Groups: members can read groups they belong to
CREATE POLICY "Members can read their groups"
  ON groups FOR SELECT
  USING (
    id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid() AND status = 'accepted')
    OR creator_id = auth.uid()
  );

CREATE POLICY "Users can create groups"
  ON groups FOR INSERT
  WITH CHECK (creator_id = auth.uid());

CREATE POLICY "Creators can update groups"
  ON groups FOR UPDATE
  USING (creator_id = auth.uid());

CREATE POLICY "Creators can delete groups"
  ON groups FOR DELETE
  USING (creator_id = auth.uid());

-- Group members
CREATE POLICY "Members can read group members"
  ON group_members FOR SELECT
  USING (
    group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Group creators and accepted members can invite"
  ON group_members FOR INSERT
  WITH CHECK (
    invited_by = auth.uid()
    AND (
      group_id IN (SELECT id FROM groups WHERE creator_id = auth.uid())
      OR group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid() AND status = 'accepted')
    )
  );

CREATE POLICY "Users can accept their own invites"
  ON group_members FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (status = 'accepted');

-- Users: allow reading handle/name/avatar for any authenticated user (needed for @handle lookup)
DROP POLICY IF EXISTS "Users can read own profile" ON users;
CREATE POLICY "Authenticated users can read public profile fields"
  ON users FOR SELECT
  USING (auth.uid() IS NOT NULL);
  -- Note: we use a Supabase view or API to expose only handle, name, avatar_url — never pix_key_encrypted

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);
```

**User profile view (safe public fields only):**

```sql
CREATE VIEW public.user_profiles AS
SELECT id, handle, name, avatar_url
FROM public.users;

-- Grant access
GRANT SELECT ON public.user_profiles TO authenticated;
```

This view ensures that even though `SELECT` is allowed on `users`, client queries to the `user_profiles` view never expose `pix_key_encrypted`, `email`, or `phone`.

### TypeScript type updates

```typescript
// src/types/index.ts additions/changes

export interface User {
  id: string;
  email: string;
  handle: string;
  name: string;
  phone?: string;
  pixKeyType: PixKeyType;
  pixKeyHint: string;       // Masked display: "p***o@gmail.com"
  avatarUrl?: string;
  createdAt: string;
}
// REMOVED: pixKey (raw key never reaches client)

export interface Group {
  id: string;
  name: string;
  creatorId: string;
  createdAt: string;
}

export type GroupMemberStatus = 'invited' | 'accepted';

export interface GroupMember {
  groupId: string;
  userId: string;
  status: GroupMemberStatus;
  invitedBy: string;
  createdAt: string;
  acceptedAt?: string;
  user?: UserProfile;  // Joined from user_profiles view
}

// Lightweight profile for display (from user_profiles view)
export interface UserProfile {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string;
}
```

---

## Workstream 2: Google OAuth authentication

### Flow

```
Landing page → "Entrar com Google" button
  → supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
  → Google consent screen
  → /auth/callback (route handler exchanges code for session)
  → Check if user.pix_key_encrypted is empty
    → Yes: redirect to /auth/onboard (handle + Pix key setup)
    → No: redirect to /app
```

### Files to create/modify

1. **`src/app/auth/callback/route.ts`** — Route handler for OAuth callback
   ```typescript
   // Exchange code for session, redirect based on onboarding status
   export async function GET(request: NextRequest) {
     const { searchParams } = new URL(request.url);
     const code = searchParams.get('code');
     // Exchange code → session
     // Check if user needs onboarding
     // Redirect accordingly
   }
   ```

2. **`src/app/auth/page.tsx`** — Replace phone+OTP with Google sign-in
   - Single "Entrar com Google" button with Google brand styling
   - Brief value prop text
   - LGPD notice

3. **`src/app/auth/onboard/page.tsx`** — New onboarding page (post-OAuth)
   - Step 1: Handle confirmation/edit (show auto-generated, allow editing)
   - Step 2: Pix key setup (inferred from email, allow different type)
   - Animated step indicator (reuse existing pattern)

### Supabase config required (manual)

- Enable Google provider in Supabase Dashboard → Authentication → Providers
- Set Google Client ID + Secret
- Add redirect URL: `{SITE_URL}/auth/callback`

---

## Workstream 3: Pix key encryption + server-side QR generation

### Encryption utility: `src/lib/crypto.ts`

```typescript
// Server-only module — never import from client components
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.PIX_ENCRYPTION_KEY!, 'hex'); // 32 bytes

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: base64(iv):base64(authTag):base64(ciphertext)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decrypt(stored: string): string {
  const [ivB64, tagB64, cipherB64] = stored.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(cipherB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

### Hint generation: `src/lib/pix-hint.ts`

Reuses existing `maskPixKey` logic from `src/lib/pix.ts` but runs before encryption, stores result in `pix_key_hint`.

### API route: `src/app/api/pix/generate/route.ts`

```typescript
// POST /api/pix/generate
// Body: { recipientUserId: string, amountCents: number, billId: string }
// Response: { copiaECola: string }
//
// Auth required. Validates caller is participant of the same bill.
// Decrypts recipient's pix_key server-side, generates Pix string, returns it.
// Never returns raw key.
```

### API route: `src/app/api/pix/qr/route.ts`

```typescript
// POST /api/pix/qr
// Body: { copiaECola: string }
// Response: PNG image (QR code)
//
// Generates QR code image from Pix Copia e Cola string.
// Separated from /generate so the client can cache the string.
```

### Client-side changes

- `PixQrModal` calls `/api/pix/generate` instead of using `generatePixCopiaECola` directly
- Remove client-side import of raw Pix key from user objects
- QR canvas rendering stays client-side (using the returned `copiaECola` string)

---

## Workstream 4: User and participant model

### Participant addition: by @handle only

Replace `AddParticipantForm` (name/phone/pixKey manual entry) with:

**`src/components/bill/add-participant-by-handle.tsx`**
- Text input with `@` prefix
- On submit: exact match lookup against `user_profiles` view
- If found: show avatar + name, confirm add
- If not found: "Nenhum usuario encontrado com esse handle"
- No search/autocomplete (prevents user enumeration)

### Recent contacts

**`src/lib/recent-contacts.ts`**
- Query: `SELECT DISTINCT user_id FROM bill_participants WHERE bill_id IN (SELECT bill_id FROM bill_participants WHERE user_id = auth.uid()) AND user_id != auth.uid()`
- Show as chips/list above the @handle input
- Tap to add directly

### Circular avatar component

**`src/components/shared/user-avatar.tsx`**
```typescript
interface UserAvatarProps {
  user: UserProfile;
  size?: 'sm' | 'md' | 'lg';
}
// Renders circular avatar with Google photo or initials fallback
// Uses next/image for optimization when URL available
```

Replace all instances of the square initial-badge pattern (`flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary`) with `<UserAvatar>`.

---

## Workstream 5: Groups with mutual confirmation

### Group creation flow

1. User taps "Novo grupo" → enters group name
2. Adds members by @handle (same component as bill participant addition)
3. Each added member gets status `'invited'`
4. Invited members see a notification/badge on their Groups tab
5. Member taps "Aceitar" → status becomes `'accepted'`
6. Only `'accepted'` members appear as selectable when creating a bill from a group

### UI: Groups page

**`src/app/app/groups/page.tsx`**
- List of groups (created + member of)
- Pending invitations section at top
- Each group card shows: name, member avatars, member count

**`src/app/app/groups/[id]/page.tsx`**
- Group detail: member list with status indicators
- "Convidar" button to add by @handle
- Group actions: rename, leave, delete (creator only)

### Navigation update

Add "Grupos" to bottom nav between "Contas" and "Nova":
```
Inicio | Contas | Grupos | Nova | Perfil
```
Wait — 5 items is the max for mobile bottom nav. Current has 4 (Inicio, Contas, Nova, Perfil). Adding Grupos makes 5, which fits.

---

## Workstream 6: User-scoped views

### Bills page: perspective-aware

Current bills page uses hardcoded data. Production version:

- Fetch from Supabase: bills where user is participant
- Each bill card shows:
  - "Voce deve R$ X" or "Te devem R$ X" or "Liquidado"
  - Participant avatars (circular)
  - Status badge

### Home page: real data

- Greeting uses actual user name from session
- Balance card: computed from ledger entries (sum of debts owed vs. owed to user)
- Recent bills: fetched from Supabase
- Avatar in header from Google profile

### Bill detail: perspective labels

- Debts where `fromUserId === currentUser`: "Voce deve para {name}"
- Debts where `toUserId === currentUser`: "{name} te deve"
- Actions: "Pagar" (you owe) vs. "Confirmar recebimento" (they owe you)

---

## Workstream 7: Public demo page

### Approach

Replace the current `loadDemo()` function (which populates the Zustand store and navigates to bill detail) with a dedicated **`/demo`** route that renders a pre-built, read-only settlement view.

**`src/app/demo/page.tsx`**
- No auth required
- Pre-computed demo data (items, splits, ledger, simplification)
- Shows:
  - Bill summary card (total, participants, items count)
  - Per-person breakdown with circular avatars
  - Debt edges with QR buttons (QR codes use hardcoded demo Pix keys, not encrypted)
  - Simplification toggle + step viewer
  - "Tudo liquidado!" celebration state (interactive toggle)
- "Criar sua conta" CTA at bottom

The landing page "Experimentar demo" button links to `/demo` instead of populating store.

---

## Implementation order

The workstreams have dependencies. Recommended sequence:

```
Phase 1 (foundation):
  WS1: Schema migration
  WS3: Encryption utility (no UI yet)

Phase 2 (auth):
  WS2: Google OAuth + onboarding
  ↳ Depends on WS1 (users table), WS3 (Pix encryption)

Phase 3 (core features):
  WS4: User/participant model
  WS5: Groups
  WS7: Demo page
  ↳ WS4 and WS7 can run in parallel
  ↳ WS5 depends on WS4 (user avatar, handle lookup)

Phase 4 (polish):
  WS6: User-scoped views
  ↳ Depends on WS2 (auth session) and WS4 (user model)
```

### Estimated file changes

| Category | New files | Modified files |
|---|---|---|
| Schema/types | 2 | 3 |
| Auth | 3 | 2 |
| Encryption/API | 3 | 2 |
| Components | 5 | 8 |
| Pages | 4 | 6 |
| **Total** | **~17** | **~21** |

---

## Environment variables required

```env
# Existing
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# New
PIX_ENCRYPTION_KEY=<64-char hex string, 32 bytes>  # Generate: openssl rand -hex 32
GOOGLE_CLIENT_ID=...      # Set in Supabase Dashboard, not in app
GOOGLE_CLIENT_SECRET=...  # Set in Supabase Dashboard, not in app
```

---

## Open items / risks

1. **Existing data migration**: Current demo users in `demo-data.ts` use plain `pixKey`. The demo page will continue using hardcoded data, so no migration needed for demo. Real users start fresh.

2. **Encryption key rotation**: If `PIX_ENCRYPTION_KEY` is compromised, all keys need re-encryption. Consider documenting a rotation procedure.

3. **Handle collisions**: The trigger handles uniqueness with a suffix counter, but edge cases exist (e.g., email local part is entirely special chars). The trigger sanitizes to `[a-z0-9._]` and pads if too short.

4. **Google avatar URLs**: Google profile picture URLs expire. Consider downloading and storing in Supabase Storage, or accepting occasional broken images.

5. **Bill-type column gap**: The `bills` SQL table lacks `bill_type`, `total_amount_input`, and `payers` columns that exist in the TypeScript types. This plan doesn't address that gap — it's a separate workstream for full Supabase sync. The current local-first Zustand approach continues for bill creation.
