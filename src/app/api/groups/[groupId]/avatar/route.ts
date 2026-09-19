import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger, logError, logWarn } from "@/lib/logger";

export const runtime = "nodejs";

const logger = createLogger("api.groups.avatar");

/**
 * Private group avatar surface. Objects live in a service-role-only storage
 * bucket; every handler rechecks membership through the RPCs instead of
 * trusting the bucket, and GET never reveals paths, keys, or existence.
 */

const AVATAR_BUCKET = "group-avatars";
/** Byte cap on PUT bodies; mirrors the bucket's file_size_limit. */
const MAX_UPLOAD_BYTES = 1024 * 1024;
/** Largest decoded pixel count we accept, matching the client's own policy. */
const MAX_DECODED_PIXELS = 40_000_000;
const AVATAR_MAX_EDGE = 512;
const AVATAR_JPEG_QUALITY = 80;

/**
 * Exact emoji palette the database check enforces. Order is display order;
 * the two presentation-suffixed glyphs must carry U+FE0F to match the
 * migration literals byte for byte.
 */
const AVATAR_EMOJI: readonly string[] = [
  "🏠",
  "🍻",
  "🍕",
  "🏖️",
  "✈️",
  "⚽",
  "🎉",
  "🐱",
] as const;

/** Wire shape of set_group_avatar until the generated types catch up. */
interface SetGroupAvatarResult {
  groupId: string;
  ledgerVersion: number;
  previousPhotoId: string | null;
}

/** Wire shape of get_group_avatar. */
type GroupAvatarRead =
  | { kind: "initials" }
  | { kind: "emoji"; emoji: string }
  | { kind: "photo"; photoId: string };

/**
 * The generated Database types predate the avatar RPCs, so these calls stay
 * pinned to the migration contract locally. Setter rejection classification
 * accepts only the P0001 code emitted by the avatar mutation.
 */

type LooseSupabaseClient = SupabaseClient<never, "public", never> & {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

async function callRpc<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: T | null; error: unknown }> {
  const loose = client as LooseSupabaseClient;
  const { data, error } = await loose.rpc(fn, args);
  return { data: data as T | null, error };
}

/** A definite Postgres rejection: the RPC raised and the transaction rolled back. */
interface Rejection {
  code: string;
  message: string;
}

function asRejection(error: unknown): Rejection | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    !("message" in error)
  ) {
    return null;
  }
  const code = error.code;
  const message = error.message;
  if (code !== "P0001" || typeof message !== "string") return null;
  return { code, message };
}

/** RPC raise messages → HTTP status. P0001 raises carry the stable code in `message`. */
const REJECTION_STATUS: Record<string, number> = {
  not_a_member: 403,
  invalid_operation: 400,
  invalid_argument: 400,
};

function avatarJson(body: Record<string, string>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function callerIdFrom(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const sub = data.claims?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

function callSetter(
  admin: SupabaseClient,
  groupId: string,
  actorId: string,
  emoji: string | null,
  photoId: string | null,
): Promise<{ data: SetGroupAvatarResult | null; error: unknown }> {
  return callRpc<SetGroupAvatarResult>(admin, "set_group_avatar", {
    p_group_id: groupId,
    p_actor_id: actorId,
    p_emoji: emoji,
    p_photo_id: photoId,
  });
}

function readAvatarState(
  supabase: SupabaseClient,
  groupId: string,
): Promise<{ data: GroupAvatarRead | null; error: unknown }> {
  return callRpc<GroupAvatarRead>(supabase, "get_group_avatar", {
    p_group_id: groupId,
  });
}

/** Maps a definite setter rejection; unanticipated raises stay a 503 unknown. */
function setterRejectionResponse(rejection: Rejection): NextResponse {
  const status = REJECTION_STATUS[rejection.message];
  if (status !== undefined) {
    return avatarJson({ error: rejection.message }, status);
  }
  logWarn(logger, "set_group_avatar raised an unmapped rejection", {
    message: rejection.message,
    code: rejection.code,
  });
  return avatarJson({ error: "avatar_update_unknown" }, 503);
}

/**
 * Best-effort object deletion. Cleanup failures are logged, never propagated:
 * an orphan in the private bucket beats failing an otherwise complete update.
 */
async function removeAvatarObject(
  admin: SupabaseClient,
  objectPath: string,
  reason: string,
): Promise<void> {
  try {
    const { error } = await admin.storage.from(AVATAR_BUCKET).remove([objectPath]);
    if (error) {
      logWarn(logger, "avatar object cleanup failed", {
        objectPath,
        reason,
        error: describeError(error),
      });
    }
  } catch (error) {
    logError(logger, "avatar object cleanup threw", error, { objectPath, reason });
  }
}

type EmojiPatch = { valid: true; emoji: string | null } | { valid: false };

/** `{kind:'initials'}` is the reset: both emoji and photo go to null. */
function parseEmojiPatch(body: unknown): EmojiPatch {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { valid: false };
  }
  if (!("kind" in body)) return { valid: false };
  const kind = body.kind;
  if (kind === "initials") return { valid: true, emoji: null };
  if (
    kind === "emoji" &&
    "emoji" in body &&
    typeof body.emoji === "string" &&
    AVATAR_EMOJI.includes(body.emoji)
  ) {
    return { valid: true, emoji: body.emoji };
  }
  return { valid: false };
}

/**
 * Accumulates the PUT body with a hard byte cap enforced on every chunk, so a
 * small or absent Content-Length cannot smuggle a larger payload through.
 */
async function readCappedBody(
  request: NextRequest,
  cap: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > cap) return { ok: false };

  if (request.body === null) return { ok: true, bytes: new Uint8Array(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * Decodes and re-encodes strictly: single-frame JPEG in, metadata-free
 * baseline JPEG out, fitted inside 512×512 without enlarging. Any other
 * input format fails closed even when sharp could decode it.
 */
async function normalizeAvatarJpeg(
  bytes: Uint8Array,
): Promise<{ ok: true; jpeg: Uint8Array } | { ok: false }> {
  try {
    const image = sharp(bytes, { failOn: "error", limitInputPixels: MAX_DECODED_PIXELS });
    const meta = await image.metadata();
    if (meta.format !== "jpeg") return { ok: false };
    if (typeof meta.pages === "number" && meta.pages > 1) return { ok: false };
    const { data } = await image
      .rotate() // auto-orient from EXIF before the re-encode strips it
      .resize(AVATAR_MAX_EDGE, AVATAR_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: AVATAR_JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, jpeg: new Uint8Array(data) };
  } catch {
    return { ok: false };
  }
}

/** Storage errors that mean "no such object", as opposed to a backend outage. */
function isAbsentObjectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, message } = error as { status?: unknown; message?: unknown };
  if (status === 404) return true;
  return typeof message === "string" && /not found|does not exist/i.test(message);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  const { groupId } = await params;

  const supabase = await createClient();
  const callerId = await callerIdFrom(supabase);
  if (!callerId) return avatarJson({ error: "unauthenticated" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return avatarJson({ error: "invalid_argument" }, 400);
  }
  const patch = parseEmojiPatch(body);
  if (!patch.valid) return avatarJson({ error: "invalid_argument" }, 400);

  const admin = createAdminClient();
  try {
    const { data, error } = await callSetter(admin, groupId, callerId, patch.emoji, null);
    if (error) {
      const rejection = asRejection(error);
      if (rejection) return setterRejectionResponse(rejection);
      logWarn(logger, "set_group_avatar failed ambiguously", {
        groupId,
        actorId: callerId,
        error: describeError(error),
      });
      return avatarJson({ error: "avatar_update_unknown" }, 503);
    }
    if (!data) {
      logWarn(logger, "set_group_avatar returned no payload", { groupId, actorId: callerId });
      return avatarJson({ error: "avatar_update_unknown" }, 503);
    }
    const previousPhotoId = data.previousPhotoId;
    if (typeof previousPhotoId === "string" && previousPhotoId.length > 0) {
      await removeAvatarObject(
        admin,
        `${groupId}/${previousPhotoId}.jpg`,
        "replaced_previous",
      );
    }
    return NextResponse.json(
      { groupId: data.groupId, ledgerVersion: data.ledgerVersion, eventId: null },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    // Network/timeout: the RPC outcome is unknown, never reported as applied.
    logWarn(logger, "set_group_avatar request threw", {
      groupId,
      actorId: callerId,
      error: describeError(error),
    });
    return avatarJson({ error: "avatar_update_unknown" }, 503);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  const { groupId } = await params;

  const supabase = await createClient();
  const callerId = await callerIdFrom(supabase);
  if (!callerId) return avatarJson({ error: "unauthenticated" }, 401);

  // Membership gate before a single upload byte is accepted: the
  // caller-scoped RPC rechecks under RLS, so a stolen session cannot even
  // push bytes for a group it does not belong to.
  const membership = await readAvatarState(supabase, groupId);
  if (membership.error) {
    const rejection = asRejection(membership.error);
    const status = rejection ? REJECTION_STATUS[rejection.message] : undefined;
    if (rejection && status !== undefined) {
      return avatarJson({ error: rejection.message }, status);
    }
    logWarn(logger, "get_group_avatar failed before upload", {
      groupId,
      actorId: callerId,
      error: describeError(membership.error),
    });
    return avatarJson({ error: "avatar_update_unknown" }, 503);
  }

  const body = await readCappedBody(request, MAX_UPLOAD_BYTES);
  if (!body.ok) return avatarJson({ error: "image_too_large" }, 413);

  const normalized = await normalizeAvatarJpeg(body.bytes);
  if (!normalized.ok) return avatarJson({ error: "invalid_image" }, 415);

  const admin = createAdminClient();
  const photoId = crypto.randomUUID();
  const objectPath = `${groupId}/${photoId}.jpg`;
  try {
    const { error: uploadError } = await admin.storage
      .from(AVATAR_BUCKET)
      .upload(objectPath, normalized.jpeg, { contentType: "image/jpeg", upsert: false });
    if (uploadError) {
      logWarn(logger, "avatar upload failed", {
        groupId,
        error: describeError(uploadError),
      });
      return avatarJson({ error: "avatar_storage_unavailable" }, 503);
    }
  } catch (error) {
    logWarn(logger, "avatar upload threw", { groupId, error: describeError(error) });
    return avatarJson({ error: "avatar_storage_unavailable" }, 503);
  }

  try {
    const { data, error } = await callSetter(admin, groupId, callerId, null, photoId);
    if (error) {
      const rejection = asRejection(error);
      if (rejection) {
        // The setter rolled back, so the fresh object is an orphan.
        await removeAvatarObject(admin, objectPath, "setter_rejected");
        return setterRejectionResponse(rejection);
      }
      logWarn(logger, "set_group_avatar failed ambiguously after upload", {
        groupId,
        actorId: callerId,
        error: describeError(error),
      });
      return avatarJson({ error: "avatar_update_unknown" }, 503);
    }
    if (!data) {
      logWarn(logger, "set_group_avatar returned no payload after upload", {
        groupId,
        actorId: callerId,
      });
      return avatarJson({ error: "avatar_update_unknown" }, 503);
    }
    // Best-effort cleanup of the replaced photo; the current one is never
    // touched (previousPhotoId === photoId cannot happen with a fresh UUID,
    // but the guard keeps the invariant local and explicit).
    const previousPhotoId = data.previousPhotoId;
    if (
      typeof previousPhotoId === "string" &&
      previousPhotoId.length > 0 &&
      previousPhotoId !== photoId
    ) {
      await removeAvatarObject(
        admin,
        `${groupId}/${previousPhotoId}.jpg`,
        "replaced_previous",
      );
    }
    return NextResponse.json(
      { groupId: data.groupId, ledgerVersion: data.ledgerVersion, eventId: null },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    // Ambiguous: the setter may have applied, so the fresh object is
    // intentionally kept — deleting it could orphan the CURRENT avatar.
    logWarn(logger, "set_group_avatar threw after upload", {
      groupId,
      actorId: callerId,
      error: describeError(error),
    });
    return avatarJson({ error: "avatar_update_unknown" }, 503);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  const { groupId } = await params;

  const supabase = await createClient();
  const callerId = await callerIdFrom(supabase);
  if (!callerId) return avatarJson({ error: "unauthenticated" }, 401);

  // Every failure below is one byte-identical 404: a caller who is not an
  // accepted member must not learn whether the group exists, is a DM, or
  // has a photo at all.
  const { data: state, error } = await readAvatarState(supabase, groupId);
  if (error || !state || state.kind !== "photo") {
    return avatarJson({ error: "not_found" }, 404);
  }

  const requestedPhotoId = request.nextUrl.searchParams.get("photoId");
  if (requestedPhotoId === null || requestedPhotoId !== state.photoId) {
    return avatarJson({ error: "not_found" }, 404);
  }

  const admin = createAdminClient();
  let blob: Blob;
  try {
    const { data, error: downloadError } = await admin.storage
      .from(AVATAR_BUCKET)
      .download(`${groupId}/${state.photoId}.jpg`);
    if (downloadError) {
      if (!isAbsentObjectError(downloadError)) {
        logWarn(logger, "avatar download failed", {
          groupId,
          error: describeError(downloadError),
        });
        return avatarJson({ error: "avatar_storage_unavailable" }, 503);
      }
      return avatarJson({ error: "not_found" }, 404);
    }
    blob = data;
  } catch (error) {
    logWarn(logger, "avatar download threw", { groupId, error: describeError(error) });
    return avatarJson({ error: "avatar_storage_unavailable" }, 503);
  }

  return new NextResponse(new Uint8Array(await blob.arrayBuffer()), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
