// Properties the synthetic specs attach to `window` from `addInitScript` /
// `page.evaluate` to smuggle state across navigations (clipboard stubs, the
// pull-to-refresh marker) and read it back.
export {};

declare global {
  interface Window {
    __copiedText?: string;
    __pullMarker?: string;
  }
}
