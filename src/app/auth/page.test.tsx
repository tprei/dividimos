import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const searchParams = new URLSearchParams();
const mockPush = vi.fn();
const decodeHolder = vi.hoisted(() => ({ payload: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: {} }),
}));

const mockGoogleSignIn = vi.fn(async () => true);
vi.mock("@/lib/capacitor/auth", () => ({
  googleSignIn: () => mockGoogleSignIn(),
  prepareGoogleSignIn: async () => undefined,
}));

vi.mock("@/components/bill/qr-scanner-view", () => ({
  QrScannerView: ({ onDecode }: { onDecode: (data: string) => void }) => (
    <button type="button" aria-label="decodificar" onClick={() => onDecode(decodeHolder.payload)} />
  ),
}));

import AuthPage from "./page";

describe("sign-in destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGoogleSignIn.mockResolvedValue(true);
    decodeHolder.payload = "";
    searchParams.set("next", "/join/abc123");
  });

  it("routes a sign-in through the onboarding decision, keeping the destination", async () => {
    render(<AuthPage />);

    fireEvent.click(screen.getByRole("button", { name: /google/i }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });

    // Going straight to /join/<token> would run the membership mutation
    // before a brand-new user has onboarded.
    const target = mockReplace.mock.calls[0]?.[0] as string;
    expect(target).toBe(`/auth/continue?next=${encodeURIComponent("/join/abc123")}`);
  });

  it("refuses an external destination before redirecting", async () => {
    searchParams.set("next", "https://evil.example.com/steal");
    render(<AuthPage />);

    fireEvent.click(screen.getByRole("button", { name: /google/i }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });

    const target = mockReplace.mock.calls[0]?.[0] as string;
    expect(target).toBe(`/auth/continue?next=${encodeURIComponent("/app")}`);
  });
});

describe("auth invitation scanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.delete("error");
    searchParams.delete("next");
    decodeHolder.payload = "";
  });

  it("opens a room invitation without putting its fragment into OAuth state", async () => {
    const roomId = "00000000-0000-4000-8000-000000000001";
    const token = `armj1_${"A".repeat(43)}`;
    decodeHolder.payload = `https://www.dividimos.ai/room/${roomId}#${token}`;
    render(<AuthPage />);

    fireEvent.click(screen.getByRole("button", { name: "Ler um convite" }));
    fireEvent.click(screen.getByRole("button", { name: "decodificar" }));

    expect(mockPush).toHaveBeenCalledWith(`/room/${roomId}#${token}`);
  });
});
