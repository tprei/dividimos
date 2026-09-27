export type NativePlatform = "android" | "ios";

export type NativeMinimumBuilds = Readonly<Record<NativePlatform, number>>;

export const MINIMUM_NATIVE_BUILDS: NativeMinimumBuilds = {
  android: 0,
  ios: 0,
};

export type NativeVersionResult = "supported" | "update-required" | "invalid-build";

export function compareNativeBuild(
  platform: string,
  build: string,
  minimums: NativeMinimumBuilds = MINIMUM_NATIVE_BUILDS,
): NativeVersionResult {
  if (platform !== "android" && platform !== "ios") return "supported";
  const minimum = minimums[platform];
  if (minimum === 0) return "supported";
  if (!/^\d+$/.test(build)) return "invalid-build";
  const installedBuild = Number(build);
  if (!Number.isSafeInteger(installedBuild)) return "invalid-build";
  return installedBuild < minimum ? "update-required" : "supported";
}
