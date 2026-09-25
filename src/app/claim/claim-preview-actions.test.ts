import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewGuestClaim } from "./claim-preview-actions";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc }),
}));

const TOKEN = `gst1_${"a".repeat(43)}`;

describe("previewGuestClaim", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("reports a failed lookup as unavailable, not as an unknown link", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function digest", code: "42501" },
    });

    await expect(previewGuestClaim(TOKEN)).resolves.toEqual({ kind: "unavailable" });
    expect(console.error).toHaveBeenCalledWith(
      "[ERROR] resolve_guest_claim_token failed",
      expect.objectContaining({
        module: "claim.preview",
        code: "42501",
        message: "permission denied for function digest",
      }),
    );
  });

  it("keeps an unknown or expired token as not_found", async () => {
    rpc.mockResolvedValue({
      data: {
        guestId: null,
        displayName: null,
        expenseTitle: null,
        groupName: null,
        shareCents: null,
        status: "not_found",
      },
      error: null,
    });

    await expect(previewGuestClaim(TOKEN)).resolves.toEqual({ kind: "not_found" });
  });
});
