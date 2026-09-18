export interface AmbientEnv {
  supabaseUrl: string;
  supabaseRef: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
  baseUrl: string;
  googleClientId: string;
}

const NAMES = [
  "AMBIENT_SUPABASE_URL",
  "AMBIENT_SUPABASE_ANON_KEY",
  "AMBIENT_SUPABASE_SERVICE_ROLE_KEY",
  "AMBIENT_SUPABASE_JWT_SECRET",
  "AMBIENT_BASE_URL",
  "AMBIENT_GOOGLE_CLIENT_ID",
] as const;

export function readAmbientEnv(): AmbientEnv {
  const missing: string[] = [];

  for (const name of NAMES) {
    const val = process.env[name];
    if (!val || val.trim() === "") {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    throw new Error("ambient: missing " + missing.join(", "));
  }

  const supabaseUrl = process.env.AMBIENT_SUPABASE_URL!.replace(/\/$/, "");
  const baseUrl = process.env.AMBIENT_BASE_URL!.replace(/\/$/, "");
  const supabaseRef = new URL(supabaseUrl).hostname.split(".")[0];

  return {
    supabaseUrl,
    supabaseRef,
    anonKey: process.env.AMBIENT_SUPABASE_ANON_KEY!,
    serviceRoleKey: process.env.AMBIENT_SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AMBIENT_SUPABASE_JWT_SECRET!,
    baseUrl,
    googleClientId: process.env.AMBIENT_GOOGLE_CLIENT_ID!,
  };
}
