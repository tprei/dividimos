export const BRAND = {
  name: "Pagajaja",
  tagline: "Já te pago",
  logoWords: ["Já", "te", "pago"] as const,
  domain: "pagajaja.app",
  localDomain: "pagajaja.local",
  testDomain: "test.pagajaja.local",
  contact: "contato@pagajaja.app",
  pwaId: "com.pagajaja.app",
  cachePrefix: "pagajaja",
  sessionPrefix: "pagajaja",
  vapidSubject: "mailto:contato@pagajaja.app",
  supabaseProjectId: "pagajaja-local",
  copyright: `© ${new Date().getFullYear()} Pagajaja`,
} as const;

export type BrandConfig = typeof BRAND;
