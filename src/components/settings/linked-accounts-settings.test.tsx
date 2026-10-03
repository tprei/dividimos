import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinkedAccountsSettings } from "./linked-accounts-settings";

const mockIsAppleSignInAvailable = vi.fn(() => true);
const mockFetchLinkedProviders = vi.fn();
const mockLinkApple = vi.fn();
const mockLinkGoogle = vi.fn();

vi.mock("@/lib/capacitor/auth", () => ({
  isAppleSignInAvailable: () => mockIsAppleSignInAvailable(),
  isNativeGoogleSignInAvailable: () => true,
}));

vi.mock("@/lib/sync/identity-links", () => ({
  fetchLinkedProviders: () => mockFetchLinkedProviders(),
  linkAppleAccount: () => mockLinkApple(),
  linkGoogleAccount: () => mockLinkGoogle(),
}));

vi.mock("@/hooks/use-haptics", () => ({
  haptics: { success: vi.fn(), error: vi.fn(), tap: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAppleSignInAvailable.mockReturnValue(true);
  mockFetchLinkedProviders.mockResolvedValue({ apple: false, google: true });
});

describe("LinkedAccountsSettings", () => {
  it("renders nothing and loads nothing outside the iOS app", () => {
    mockIsAppleSignInAvailable.mockReturnValue(false);
    const { container } = render(<LinkedAccountsSettings />);

    expect(container).toBeEmptyDOMElement();
    expect(mockFetchLinkedProviders).not.toHaveBeenCalled();
  });

  it("marks Apple as connected after a successful link", async () => {
    mockLinkApple.mockResolvedValue({ status: "linked", provider: "apple", authorizationCode: "code" });
    const user = userEvent.setup();
    render(<LinkedAccountsSettings />);

    await user.click(await screen.findByRole("button", { name: /conectar.*apple/i }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /conectar.*apple/i })).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a failed link and keeps the action available", async () => {
    mockLinkApple.mockResolvedValue({ status: "failed", reason: "identity_in_use" });
    const user = userEvent.setup();
    render(<LinkedAccountsSettings />);

    await user.click(await screen.findByRole("button", { name: /conectar.*apple/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /conectar.*apple/i })).toBeEnabled();
  });

  it("settles silently when the person cancels the sheet", async () => {
    mockLinkApple.mockResolvedValue({ status: "cancelled" });
    const user = userEvent.setup();
    render(<LinkedAccountsSettings />);

    await user.click(await screen.findByRole("button", { name: /conectar.*apple/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /conectar.*apple/i })).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("loads the providers again after a failed read", async () => {
    mockFetchLinkedProviders.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<LinkedAccountsSettings />);

    await user.click(await screen.findByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByRole("button", { name: /conectar.*apple/i })).toBeEnabled();
    expect(mockFetchLinkedProviders).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
