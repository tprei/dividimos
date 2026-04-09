import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GroupInviteModal } from "./group-invite-modal";

vi.mock("qrcode", () => ({
  default: { toCanvas: vi.fn() },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/contacts", () => ({
  isContactPickerSupported: () => false,
  pickContacts: vi.fn(),
  buildWhatsAppLink: (msg: string, phone?: string) =>
    phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`,
}));

describe("GroupInviteModal", () => {
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
      <GroupInviteModal {...defaultProps} open={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders group name and heading when open", () => {
    render(<GroupInviteModal {...defaultProps} />);
    expect(screen.getByText("Convite para o grupo")).toBeInTheDocument();
    expect(screen.getByText("Churrasco")).toBeInTheDocument();
  });

  it("renders copy and WhatsApp buttons", () => {
    render(<GroupInviteModal {...defaultProps} />);
    expect(screen.getByText("Copiar link")).toBeInTheDocument();
    expect(screen.getByText("Enviar pelo WhatsApp")).toBeInTheDocument();
  });

  it("copies link to clipboard on copy button click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<GroupInviteModal {...defaultProps} />);
    fireEvent.click(screen.getByText("Copiar link"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/join/abc-123-token"),
      );
    });
  });

  it("calls onClose when X button is clicked", () => {
    render(<GroupInviteModal {...defaultProps} />);
    const closeButtons = screen.getAllByRole("button");
    const xButton = closeButtons.find(
      (btn) => btn.querySelector("svg") && !btn.textContent?.trim(),
    );
    expect(xButton).toBeDefined();
    fireEvent.click(xButton!);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("calls onClose when backdrop is clicked", () => {
    render(<GroupInviteModal {...defaultProps} />);
    const backdrop = screen.getByText("Convite para o grupo").closest(
      ".fixed",
    );
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(defaultProps.onClose).toHaveBeenCalled();
    }
  });

  it("renders QR hint text", () => {
    render(<GroupInviteModal {...defaultProps} />);
    expect(
      screen.getByText("Escaneie ou compartilhe o link para entrar no grupo"),
    ).toBeInTheDocument();
  });
});
