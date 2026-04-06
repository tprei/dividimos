import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

function silent(fn: () => Promise<void>): void {
  fn().catch(() => {});
}

/**
 * Plain-object haptics API — safe to call from hooks, utilities, and
 * non-component code (e.g. usePullToRefresh). Every call is fire-and-forget
 * and silently no-ops on platforms without haptic support.
 */
export const haptics = {
  tap() {
    silent(() => Haptics.impact({ style: ImpactStyle.Light }));
  },
  impact() {
    silent(() => Haptics.impact({ style: ImpactStyle.Medium }));
  },
  success() {
    silent(() => Haptics.notification({ type: NotificationType.Success }));
  },
  error() {
    silent(() => Haptics.notification({ type: NotificationType.Error }));
  },
  selectionChanged() {
    silent(() =>
      Haptics.selectionStart()
        .then(() => Haptics.selectionChanged())
        .then(() => Haptics.selectionEnd()),
    );
  },
} as const;

export function useHaptics() {
  return haptics;
}
