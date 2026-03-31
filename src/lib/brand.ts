export const BRAND = {
  name: "Dividimos",
  tagline: "Vamos dividir",
  logoWords: ["Di", "vi", "di", "mos"] as const,
  domain: "dividimos.ai",
  localDomain: "dividimos.local",
  testDomain: "test.dividimos.local",
  contact: "contato@dividimos.ai",
  pwaId: "ai.dividimos.app",
  cachePrefix: "dividimos",
  sessionPrefix: "dividimos",
  vapidSubject: "mailto:contato@dividimos.ai",
  supabaseProjectId: "dividimos-local",
  copyright: `© ${new Date().getFullYear()} Dividimos`,
} as const;

export type BrandConfig = typeof BRAND;
