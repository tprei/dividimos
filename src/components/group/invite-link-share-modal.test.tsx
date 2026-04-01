import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InviteLinkShareModal } from "./invite-link-share-modal";

vi.mock("qrcode", () => ({
  default: { toCanvas: vi.fn() },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe("InviteLinkShareModal", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    groupName: "Churrasco",
    token: "abc-123-token",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <InviteLinkShareModal {...defaultProps} open={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders group name and heading when open", () => {
    render(<InviteLinkShareModal {...defaultProps} />);
    expect(screen.getByText("Convite para o grupo")).toBeInTheDocument();
    expect(screen.getByText("Churrasco")).toBeInTheDocument();
  });

  it("renders copy button", () => {
    render(<InviteLinkShareModal {...defaultProps} />);
    expect(screen.getByText("Copiar link")).toBeInTheDocument();
  });

  it("copies link to clipboard on copy button click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<InviteLinkShareModal {...defaultProps} />);
    fireEvent.click(screen.getByText("Copiar link"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/join/abc-123-token"),
      );
    });
  });

  it("calls onClose when X button is clicked", () => {
    render(<InviteLinkShareModal {...defaultProps} />);
    const closeButtons = screen.getAllByRole("button");
    // The X close button is the one without text content
    const xButton = closeButtons.find(
      (btn) => btn.querySelector("svg") && !btn.textContent?.trim(),
    );
    expect(xButton).toBeDefined();
    fireEvent.click(xButton!);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("calls onClose when backdrop is clicked", () => {
    render(<InviteLinkShareModal {...defaultProps} />);
    // Click the backdrop (outermost motion.div)
    const backdrop = screen.getByText("Convite para o grupo").closest(
      ".fixed",
    );
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(defaultProps.onClose).toHaveBeenCalled();
    }
  });

  it("renders QR hint text", () => {
    render(<InviteLinkShareModal {...defaultProps} />);
    expect(
      screen.getByText("Qualquer pessoa com este link pode entrar no grupo"),
    ).toBeInTheDocument();
  });
});
