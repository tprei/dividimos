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

const mockGoogleSignIn = vi.fn();
const mockAppleSignIn = vi.fn();
const mockIsNativePlatform = vi.fn(() => true);
const mockIsAppleSignInAvailable = vi.fn(() => false);
const mockIsNativeGoogleSignInAvailable = vi.fn(() => true);
const mockStartGoogleRedirect = vi.fn<(next: string) => Promise<void>>(async () => undefined);

vi.mock("@/lib/capacitor/auth", () => ({
  googleSignIn: () => mockGoogleSignIn(),
  appleSignIn: () => mockAppleSignIn(),
  isNativePlatform: () => mockIsNativePlatform(),
  isAppleSignInAvailable: () => mockIsAppleSignInAvailable(),
  isNativeGoogleSignInAvailable: () => mockIsNativeGoogleSignInAvailable(),
  prepareGoogleSignIn: async () => undefined,
  prepareAppleSignIn: async () => undefined,
  startGoogleRedirect: (next: string) => mockStartGoogleRedirect(next),
}));

vi.mock("@/components/bill/qr-scanner-view", () => ({
  QrScannerView: ({ onDecode }: { onDecode: (data: string) => void }) => (
    <button type="button" aria-label="decodificar" onClick={() => onDecode(decodeHolder.payload)} />
  ),
}));

import { AuthPanel } from "./auth-panel";

describe("sign-in destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGoogleSignIn.mockResolvedValue({
      status: "signed_in",
      provider: "google",
      authorizationCode: null,
    });
    mockAppleSignIn.mockResolvedValue({
      status: "signed_in",
      provider: "apple",
      authorizationCode: "apple-auth-code",
    });
    mockIsNativePlatform.mockReturnValue(true);
    mockIsAppleSignInAvailable.mockReturnValue(false);
    mockIsNativeGoogleSignInAvailable.mockReturnValue(true);
    decodeHolder.payload = "";
    searchParams.set("next", "/join/abc123");
  });

  it("keeps a failed Google sign-in inline and allows retry", async () => {
    mockGoogleSignIn.mockResolvedValueOnce({ status: "failed", reason: "rejected" });
    render(<AuthPanel />);
    fireEvent.click(screen.getByRole("button", { name: /google/i }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("button", { name: /google/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /google/i }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/auth/continue?next=%2Fjoin%2Fabc123"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("routes a sign-in through the onboarding decision, keeping the destination", async () => {
    render(<AuthPanel />);

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
    render(<AuthPanel />);

    fireEvent.click(screen.getByRole("button", { name: /google/i }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });

    const target = mockReplace.mock.calls[0]?.[0] as string;
    expect(target).toBe(`/auth/continue?next=${encodeURIComponent("/app")}`);
  });

  it("hands the sanitized destination to the web redirect instead of navigating itself", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    searchParams.set("next", "https://evil.example.com/steal");
    render(<AuthPanel />);

    fireEvent.click(screen.getByRole("button", { name: /google/i }));

    await waitFor(() => {
      expect(mockStartGoogleRedirect).toHaveBeenCalledWith("/app");
    });
    expect(mockGoogleSignIn).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("Sign in with Apple behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNativePlatform.mockReturnValue(true);
    mockIsAppleSignInAvailable.mockReturnValue(true);
    mockIsNativeGoogleSignInAvailable.mockReturnValue(true);
    searchParams.set("next", "/app/groups");
  });

  it("renders Apple button above Google on iOS", () => {
    render(<AuthPanel />);
    const buttons = screen.getAllByRole("button");
    const appleBtn = screen.getByRole("button", { name: /apple/i });
    const googleBtn = screen.getByRole("button", { name: /google/i });
    expect(appleBtn).toBeInTheDocument();
    expect(googleBtn).toBeInTheDocument();
    expect(buttons.indexOf(appleBtn)).toBeLessThan(buttons.indexOf(googleBtn));
  });

  it("does not render Apple button when isAppleSignInAvailable is false", () => {
    mockIsAppleSignInAvailable.mockReturnValue(false);
    render(<AuthPanel />);
    expect(screen.queryByRole("button", { name: /apple/i })).not.toBeInTheDocument();
  });

  it("hides Google button on native when isNativeGoogleSignInAvailable is false", () => {
    mockIsNativeGoogleSignInAvailable.mockReturnValue(false);
    render(<AuthPanel />);
    expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apple/i })).toBeInTheDocument();
  });

  it("disables both buttons while Apple sign-in is pending", async () => {
    let resolveApple!: (val: unknown) => void;
    mockAppleSignIn.mockReturnValue(
      new Promise((res) => {
        resolveApple = res;
      }),
    );
    render(<AuthPanel />);

    const appleBtn = screen.getByRole("button", { name: /apple/i });
    const googleBtn = screen.getByRole("button", { name: /google/i });

    fireEvent.click(appleBtn);

    expect(appleBtn).toBeDisabled();
    expect(googleBtn).toBeDisabled();

    resolveApple({ status: "cancelled" });
    await waitFor(() => {
      expect(appleBtn).toBeEnabled();
      expect(googleBtn).toBeEnabled();
    });
  });

  it("disables both buttons while Google sign-in is pending", async () => {
    let resolveGoogle!: (val: unknown) => void;
    mockGoogleSignIn.mockReturnValue(
      new Promise((res) => {
        resolveGoogle = res;
      }),
    );
    render(<AuthPanel />);

    const appleBtn = screen.getByRole("button", { name: /apple/i });
    const googleBtn = screen.getByRole("button", { name: /google/i });

    fireEvent.click(googleBtn);

    expect(appleBtn).toBeDisabled();
    expect(googleBtn).toBeDisabled();

    resolveGoogle({ status: "cancelled" });
    await waitFor(() => {
      expect(appleBtn).toBeEnabled();
      expect(googleBtn).toBeEnabled();
    });
  });

  it("clears pending silently on user cancellation without showing error", async () => {
    mockAppleSignIn.mockResolvedValueOnce({ status: "cancelled" });
    render(<AuthPanel />);

    fireEvent.click(screen.getByRole("button", { name: /apple/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /apple/i })).toBeEnabled();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error banner when Apple sign-in fails", async () => {
    mockAppleSignIn.mockResolvedValueOnce({ status: "failed", reason: "network" });
    render(<AuthPanel />);

    fireEvent.click(screen.getByRole("button", { name: /apple/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("routes to /auth/continue with next parameter preserved on successful Apple sign in", async () => {
    mockAppleSignIn.mockResolvedValueOnce({
      status: "signed_in",
      provider: "apple",
      authorizationCode: "apple-auth-code",
    });
    render(<AuthPanel />);

    fireEvent.click(screen.getByRole("button", { name: /apple/i }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/auth/continue?next=%2Fapp%2Fgroups");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});

describe("callback failure alert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.delete("error");
    searchParams.delete("next");
    decodeHolder.payload = "";
  });

  it("dismisses the alert and keeps next while dropping error", () => {
    searchParams.set("error", "callback_failed");
    searchParams.set("next", "/join/test");
    render(<AuthPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Dispensar aviso" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith("/auth?next=%2Fjoin%2Ftest");
  });

  it("renders nothing for an unrecognized error value", () => {
    searchParams.set("error", "random_error");
    render(<AuthPanel />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
    render(<AuthPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Ler um convite" }));
    fireEvent.click(screen.getByRole("button", { name: "decodificar" }));

    expect(mockPush).toHaveBeenCalledWith(`/room/${roomId}#${token}`);
  });
});
