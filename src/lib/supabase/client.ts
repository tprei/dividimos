"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

export function getSupabaseStorageNamespace(): string {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for browser storage");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin === "null" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must have a valid public origin");
  }

  return url.origin;
}

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
