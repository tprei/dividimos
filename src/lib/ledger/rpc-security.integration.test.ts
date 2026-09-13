import { describe, expect, it } from "vitest";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import { authenticateAs, createTestUser } from "@/test/integration-helpers";

// The receipt-key lock helper is internal machinery for the ledger RPCs.
// Fresh migration replay used to keep PostgreSQL's default PUBLIC execute
// grant on it, so any browser role could take the advisory lock directly.
// These tests pin the privilege contract the security gate also asserts.
describe.skipIf(!isIntegrationTestReady)("receipt helper privilege contract", () => {
  it("denies anon execution of lock_receipt_key", async () => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/lock_receipt_key`,
      {
        method: "POST",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_creator_id: "00000000-0000-0000-0000-000000000000",
          p_chave_acesso: "35260927654896000136550010000927651092765109",
        }),
      },
    );
    const body = (await response.json()) as { message?: string };
    expect(response.ok).toBe(false);
    expect(body.message).toMatch(/permission denied for function lock_receipt_key/);
  });

  it("denies authenticated execution of lock_receipt_key", async () => {
    const user = await createTestUser();
    const client = authenticateAs(user);
    const { error } = await client.rpc("lock_receipt_key", {
      p_creator_id: user.id,
      p_chave_acesso: "35260927654896000136550010000927651092765109",
    });
    expect(error?.message).toMatch(/permission denied for function lock_receipt_key/);
  });

  it("keeps service-role execution of lock_receipt_key", async () => {
    const { error } = await adminClient!.rpc("lock_receipt_key", {
      p_creator_id: "00000000-0000-0000-0000-000000000000",
      p_chave_acesso: "35260927654896000136550010000927651092765109",
    });
    expect(error).toBeNull();
  });
});
