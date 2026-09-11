import { Capacitor } from "@capacitor/core";

/** How a capture attempt settled. Only `captured` carries a photo. */
export type PhotoOutcome =
  | { kind: "captured"; file: File }
  | { kind: "cancelled" }
  | { kind: "permission_denied" }
  | { kind: "error"; message: string };

export function isNativeCameraAvailable(): boolean {
  return Capacitor.getPlatform() === "android";
}

/** Plugin messages for a user backing out, which is not a failure. */
const CANCEL_PATTERN = /cancel|cancell?ed|user cancelled photos app/i;

/** Plugin messages for a refused permission, which needs guidance. */
const DENIED_PATTERN = /permission|denied|not authorized|no access/i;

function classify(cause: unknown): PhotoOutcome {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  if (CANCEL_PATTERN.test(message)) return { kind: "cancelled" };
  if (DENIED_PATTERN.test(message)) return { kind: "permission_denied" };
  return {
    kind: "error",
    message: message || "Não foi possível abrir a câmera.",
  };
}

async function capture(source: "camera" | "gallery"): Promise<PhotoOutcome> {
  let Camera, CameraResultType, CameraSource;
  try {
    ({ Camera, CameraResultType, CameraSource } = await import("@capacitor/camera"));
  } catch (cause) {
    return classify(cause);
  }

  try {
    const photo = await Camera.getPhoto({
      source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
      resultType: CameraResultType.Uri,
      quality: 90,
    });

    // A photo without a readable path is a failure, not a picture: reading
    // `webPath!` turned it into an unexplained throw the caller called a
    // cancellation.
    if (!photo.webPath) {
      return { kind: "error", message: "A foto não pôde ser lida." };
    }

    const response = await fetch(photo.webPath);
    if (!response.ok) {
      return { kind: "error", message: "A foto não pôde ser lida." };
    }

    const blob = await response.blob();
    const extension = photo.format ?? "jpeg";
    return {
      kind: "captured",
      file: new File([blob], `photo.${extension}`, { type: `image/${extension}` }),
    };
  } catch (cause) {
    return classify(cause);
  }
}

export function takeNativePhoto(): Promise<PhotoOutcome> {
  return capture("camera");
}

export function pickNativeGalleryPhoto(): Promise<PhotoOutcome> {
  return capture("gallery");
}
