import { compressImage, ImagePolicyError } from "@/lib/image-utils";
import { getAuthGeneration } from "./client";
import { codeFromMessage, LedgerError } from "./errors";
import { refreshGroup } from "./refresh";

/**
 * Group avatar mutations ride a dedicated HTTP route instead of the shared
 * rpc() helper: a photo upload streams bytes through PUT, which supabase-js
 * cannot express, and every failure decodes the route's stable
 * `{error: code}` body. Files and object URLs never enter the store — the
 * ack-triggered refresh pulls the new avatar in with the server snapshot.
 */

export type GroupAvatarUpdate =
  | { kind: "initials" }
  | { kind: "emoji"; emoji: string }
  | { kind: "photo"; file: File };

/**
 * Stable `{error: code}` failures → typed errors carrying the app's PT-BR
 * copy. Codes the sync layer already knows pass through; image-size and
 * storage-shape rejections need avatar-specific wording.
 */
function failureFrom(status: number, code: string): LedgerError {
  if (status === 401) return new LedgerError("unauthenticated");
  if (status === 403 && code === "not_a_member") return new LedgerError("not_a_member");
  if (status === 400 && code === "invalid_operation") {
    return new LedgerError("invalid_argument", {
      message: "Não dá para definir avatar de uma conversa direta.",
    });
  }
  if (status === 400 && code === "invalid_argument") {
    return new LedgerError("invalid_argument");
  }
  if (status === 413) {
    return new LedgerError("invalid_argument", {
      message: "A foto passa de 1 MB. Escolha uma menor.",
    });
  }
  if (status === 415) {
    return new LedgerError("invalid_argument", {
      message: "Essa foto não é um JPEG válido.",
    });
  }
  const known = codeFromMessage(code);
  if (known !== "unknown") return new LedgerError(known, { cause: status });
  return new LedgerError("network", {
    message: "Não deu para atualizar o avatar agora. Tente de novo.",
    cause: status,
  });
}

/** Recovers the stable code from a `{error: code}` body; anything else is "". */
function decodeErrorCode(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "";
  const code = (body as { error?: unknown }).error;
  return typeof code === "string" ? code : "";
}

async function sendAvatarMutation(
  groupId: string,
  method: "PATCH" | "PUT",
  body: BodyInit,
  json: boolean,
  generation: number,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/avatar`, {
      method,
      headers: json ? { "Content-Type": "application/json" } : undefined,
      body,
    });
  } catch (error) {
    throw new LedgerError("network", { cause: error });
  }

  // A sign-in that lands mid-flight invalidates everything this request was
  // about to observe or publish, including the error body below.
  if (getAuthGeneration() !== generation) throw new LedgerError("unauthenticated");
  if (response.ok) return;
  const code = decodeErrorCode(await response.json().catch(() => undefined));
  if (getAuthGeneration() !== generation) throw new LedgerError("unauthenticated");
  throw failureFrom(response.status, code);
}

export async function updateGroupAvatar(
  groupId: string,
  avatar: GroupAvatarUpdate,
): Promise<void> {
  const generation = getAuthGeneration();

  if (avatar.kind === "photo") {
    let compressed: File;
    try {
      compressed = await compressImage(avatar.file, {
        maxSize: 512,
        quality: 0.8,
        type: "image/jpeg",
      });
    } catch (error) {
      throw error instanceof ImagePolicyError
        ? new LedgerError("invalid_argument", {
            message: "A foto é grande demais. Escolha uma menor.",
            cause: error,
          })
        : new LedgerError("invalid_argument", {
            message: "Não deu para preparar essa foto. Tente outra.",
            cause: error,
          });
    }
    if (getAuthGeneration() !== generation) throw new LedgerError("unauthenticated");
    await sendAvatarMutation(groupId, "PUT", compressed, false, generation);
  } else {
    const payload =
      avatar.kind === "emoji"
        ? { kind: "emoji", emoji: avatar.emoji }
        : { kind: "initials" };
    await sendAvatarMutation(groupId, "PATCH", JSON.stringify(payload), true, generation);
  }

  if (getAuthGeneration() !== generation) throw new LedgerError("unauthenticated");
  // Exactly one refresh: the group snapshot is the only thing that changes.
  void refreshGroup(groupId);
}
