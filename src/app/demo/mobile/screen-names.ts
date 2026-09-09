export const SCREEN_NAMES = [
  "home",
  "conversations",
  "chat",
  "groups",
  "bill-single",
  "bill-itemized",
  "receipt",
  "settlement",
  "profile",
  "bill-created",
] as const;

export type ScreenName = (typeof SCREEN_NAMES)[number];

export function isScreenName(value: string): value is ScreenName {
  return (SCREEN_NAMES as readonly string[]).includes(value);
}
