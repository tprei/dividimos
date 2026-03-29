import { describe, it, expect } from "vitest";
import {
  adminClient,
  isIntegrationTestReady,
} from "@/test/integration-setup";
import { createTestUser } from "@/test/integration-helpers";

describe.skipIf(!isIntegrationTestReady)(
  "2FA columns on users table",
  () => {
    it("new users have two_factor_enabled = false by default", async () => {
      const user = await createTestUser();

      const { data, error } = await adminClient!
        .from("users")
        .select("two_factor_enabled, two_factor_phone, two_factor_code_hash, two_factor_code_created_at")
        .eq("id", user.id)
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.two_factor_enabled).toBe(false);
      expect(data!.two_factor_phone).toBeNull();
      expect(data!.two_factor_code_hash).toBeNull();
      expect(data!.two_factor_code_created_at).toBeNull();
    });

    it("can update two_factor_enabled and two_factor_phone", async () => {
      const user = await createTestUser();

      const { error: updateError } = await adminClient!
        .from("users")
        .update({
          two_factor_enabled: true,
          two_factor_phone: "encrypted_phone_value",
        })
        .eq("id", user.id);

      expect(updateError).toBeNull();

      const { data, error } = await adminClient!
        .from("users")
        .select("two_factor_enabled, two_factor_phone")
        .eq("id", user.id)
        .single();

      expect(error).toBeNull();
      expect(data!.two_factor_enabled).toBe(true);
      expect(data!.two_factor_phone).toBe("encrypted_phone_value");
    });

    it("can store and clear verification code hash with timestamp", async () => {
      const user = await createTestUser();
      const now = new Date().toISOString();

      // Set code hash and timestamp
      const { error: setError } = await adminClient!
        .from("users")
        .update({
          two_factor_code_hash: "sha256_hash_value",
          two_factor_code_created_at: now,
        })
        .eq("id", user.id);

      expect(setError).toBeNull();

      const { data: withCode } = await adminClient!
        .from("users")
        .select("two_factor_code_hash, two_factor_code_created_at")
        .eq("id", user.id)
        .single();

      expect(withCode!.two_factor_code_hash).toBe("sha256_hash_value");
      expect(withCode!.two_factor_code_created_at).not.toBeNull();

      // Clear code hash after successful verification
      const { error: clearError } = await adminClient!
        .from("users")
        .update({
          two_factor_code_hash: null,
          two_factor_code_created_at: null,
        })
        .eq("id", user.id);

      expect(clearError).toBeNull();

      const { data: cleared } = await adminClient!
        .from("users")
        .select("two_factor_code_hash, two_factor_code_created_at")
        .eq("id", user.id)
        .single();

      expect(cleared!.two_factor_code_hash).toBeNull();
      expect(cleared!.two_factor_code_created_at).toBeNull();
    });

    it("two_factor_phone is not exposed via user_profiles view", async () => {
      const user = await createTestUser();

      // Enable 2FA with a phone number
      await adminClient!
        .from("users")
        .update({
          two_factor_enabled: true,
          two_factor_phone: "encrypted_secret",
        })
        .eq("id", user.id);

      // The user_profiles view should not contain 2FA columns
      const { data, error } = await adminClient!
        .from("user_profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      // user_profiles only exposes: id, handle, name, avatar_url
      const keys = Object.keys(data!);
      expect(keys).not.toContain("two_factor_enabled");
      expect(keys).not.toContain("two_factor_phone");
      expect(keys).not.toContain("two_factor_code_hash");
      expect(keys).not.toContain("two_factor_code_created_at");
    });
  },
);
