type EnvVar = {
  name: string;
  required: boolean;
  devOnly?: boolean;
};

const ENV_VARS: EnvVar[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", required: true },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: false },
  { name: "PIX_ENCRYPTION_KEY", required: false },
  { name: "NEXT_PUBLIC_AUTH_PHONE_TEST_MODE", required: false, devOnly: true },
];

interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

export function validateEnv(): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const envVar of ENV_VARS) {
    const value = process.env[envVar.name];

    if (!value) {
      if (envVar.required) {
        missing.push(envVar.name);
      } else if (envVar.devOnly && process.env.NODE_ENV !== "production") {
        // Dev-only vars are only warned in development
        warnings.push(`${envVar.name} is not set`);
      }
    }

    // Warn if dev-only vars are set in production
    if (envVar.devOnly && value && process.env.NODE_ENV === "production") {
      warnings.push(`${envVar.name} should not be set in production`);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Get required environment variable or throw error
 */
export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Get optional environment variable with default
 */
export function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}
