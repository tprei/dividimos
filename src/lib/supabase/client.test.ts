import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseStorageNamespace } from "./client";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSupabaseStorageNamespace", () => {
  it("uses the canonical origin and ignores a URL path", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co/rest/v1");

    expect(getSupabaseStorageNamespace()).toBe("https://project.supabase.co");
  });

  it("rejects a missing or malformed public URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(() => getSupabaseStorageNamespace()).toThrow("NEXT_PUBLIC_SUPABASE_URL");

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "ftp://project.supabase.co");
    expect(() => getSupabaseStorageNamespace()).toThrow("valid public origin");
  });

  it("rejects credentials embedded in the URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://user:password@project.supabase.co");

    expect(() => getSupabaseStorageNamespace()).toThrow("valid public origin");
  });
});
