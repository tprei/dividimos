"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { CURRENT_FINANCIAL_SCHEMA_VERSION, FINANCIAL_SCHEMA_HEADER_NAME } from "@/lib/financial-compatibility";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { [FINANCIAL_SCHEMA_HEADER_NAME]: String(CURRENT_FINANCIAL_SCHEMA_VERSION) },
      },
    },
  );
}
