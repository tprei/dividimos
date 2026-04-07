import { Capacitor } from "@capacitor/core";

export function isNativeCameraAvailable(): boolean {
  return Capacitor.getPlatform() === "android";
}

export async function takeNativePhoto(): Promise<File> {
  const { Camera, CameraResultType, CameraSource } = await import(
    "@capacitor/camera"
  );

  const permResult = await Camera.requestPermissions({ permissions: ["camera"] });
  if (permResult.camera !== "granted") {
    throw new Error("Permissão da câmera negada. Verifique as configurações.");
  }

  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    resultType: CameraResultType.Uri,
    quality: 90,
  });

  const response = await fetch(photo.webPath!);
  const blob = await response.blob();
  const extension = photo.format ?? "jpeg";
  return new File([blob], `photo.${extension}`, {
    type: `image/${extension}`,
  });
}

export async function pickNativeGalleryPhoto(): Promise<File> {
  const { Camera, CameraResultType, CameraSource } = await import(
    "@capacitor/camera"
  );

  const permResult = await Camera.requestPermissions({ permissions: ["photos"] });
  if (permResult.photos !== "granted") {
    throw new Error("Permissão da galeria negada. Verifique as configurações.");
  }

  const photo = await Camera.getPhoto({
    source: CameraSource.Photos,
    resultType: CameraResultType.Uri,
    quality: 90,
  });

  const response = await fetch(photo.webPath!);
  const blob = await response.blob();
  const extension = photo.format ?? "jpeg";
  return new File([blob], `photo.${extension}`, {
    type: `image/${extension}`,
  });
}
