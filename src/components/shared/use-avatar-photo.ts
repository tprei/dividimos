"use client";

import { useCallback, useState } from "react";

type PhotoState = "loading" | "loaded" | "cached" | "error";

export function useAvatarPhoto(url: string | null | undefined) {
  const [photoState, setPhotoState] = useState<PhotoState>("loading");
  const [previousUrl, setPreviousUrl] = useState(url);
  if (previousUrl !== url) {
    setPreviousUrl(url);
    setPhotoState("loading");
  }
  const attachPhoto = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth > 0) setPhotoState("cached");
  }, []);
  const handleLoad = useCallback(() => {
    setPhotoState((current) => current === "cached" ? current : "loaded");
  }, []);
  const handleError = useCallback(() => setPhotoState("error"), []);
  const photoClassName = photoState === "cached"
    ? "object-cover opacity-100"
    : `object-cover transition-opacity duration-150 motion-reduce:transition-none ${photoState === "loaded" ? "opacity-100" : "opacity-0"}`;

  return { photoState, photoClassName, attachPhoto, handleLoad, handleError };
}
