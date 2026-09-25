import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBackHandlers } from "@/lib/capacitor/back-handler";
import { GuestClaimShareModal } from "./guest-claim-share-modal";

vi.mock("@/lib/qr", () => ({
  qrToCanvas: vi.fn(() => Promise.resolve()),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  guestName: "João",
  token: "test-token-123",
  shareAmountCents: 4500,
  expenseTitle: "Almoço",
};

describe("GuestClaimShareModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed or token is null", () => {
    const { container, rerender } = render(
      <GuestClaimShareModal {...defaultProps} open={false} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<GuestClaimShareModal {...defaultProps} token={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("displays guest name and expense amount", () => {
    render(<GuestClaimShareModal {...defaultProps} />);
    expect(screen.getByText("João")).toBeInTheDocument();
  });

  it("closes on hardware Back instead of navigating away", () => {
    render(<GuestClaimShareModal {...defaultProps} />);
    expect(runBackHandlers()).toBe(true);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("copies the link when copy button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const toast = await import("react-hot-toast");

    render(<GuestClaimShareModal {...defaultProps} />);
    fireEvent.click(screen.getByText("Copiar link"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("#test-token-123"),
      );
    });
    expect(toast.default.success).toHaveBeenCalledWith("Link copiado!");
    vi.unstubAllGlobals();
  });

  it("shows failure toast when copying fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const toast = await import("react-hot-toast");

    render(<GuestClaimShareModal {...defaultProps} />);
    fireEvent.click(screen.getByText("Copiar link"));

    await waitFor(() => {
      expect(toast.default.error).toHaveBeenCalledWith("Não deu pra copiar");
    });
    vi.unstubAllGlobals();
  });
});