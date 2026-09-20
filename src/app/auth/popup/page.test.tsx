import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: {} }),
}));

const mockCompleteGoogleRedirect = vi.fn<() => Promise<string | null>>();
vi.mock("@/lib/capacitor/auth", () => ({
  completeGoogleRedirect: () => mockCompleteGoogleRedirect(),
}));

import AuthPopupPage from "./page";

describe("google redirect return page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("continues to the onboarding decision with the destination it stored", async () => {
    mockCompleteGoogleRedirect.mockResolvedValue("/join/abc123");
    render(<AuthPopupPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        `/auth/continue?next=${encodeURIComponent("/join/abc123")}`,
      );
    });
  });

  it("sends a rejected token back to the sign-in screen with the failure flag", async () => {
    mockCompleteGoogleRedirect.mockResolvedValue(null);
    render(<AuthPopupPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/auth?error=callback_failed");
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("sends a thrown exchange back to the sign-in screen", async () => {
    mockCompleteGoogleRedirect.mockRejectedValue(new Error("offline"));
    render(<AuthPopupPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/auth?error=callback_failed");
    });
  });
});
