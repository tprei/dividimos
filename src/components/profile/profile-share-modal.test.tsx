import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProfileShareModal } from "./profile-share-modal";

vi.mock("qrcode", () => ({
  default: { toCanvas: vi.fn() },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill, ...rest } = props;
    return <img {...rest} data-fill={fill ? "true" : undefined} />;
  },
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  handle: "maria",
  name: "Maria Silva",
  avatarUrl: "https://example.com/avatar.jpg",
};

describe("ProfileShareModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ProfileShareModal {...defaultProps} open={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("displays user name and handle", () => {
    render(<ProfileShareModal {...defaultProps} />);
    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getByText("@maria")).toBeInTheDocument();
  });

  it("displays the modal title", () => {
    render(<ProfileShareModal {...defaultProps} />);
    expect(screen.getByText("Meu perfil")).toBeInTheDocument();
  });

  it("renders a canvas for the QR code", () => {
    const { container } = render(<ProfileShareModal {...defaultProps} />);
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    render(<ProfileShareModal {...defaultProps} />);
    const closeButton = screen.getByRole("button", { name: "" });
    fireEvent.click(closeButton);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("renders the WhatsApp button", () => {
    render(<ProfileShareModal {...defaultProps} />);
    expect(screen.getByText("Enviar pelo WhatsApp")).toBeInTheDocument();
  });

  it("renders the copy link button", () => {
    render(<ProfileShareModal {...defaultProps} />);
    expect(screen.getByText("Copiar link")).toBeInTheDocument();
  });

  it("copies the profile URL when copy button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const toast = await import("react-hot-toast");

    render(<ProfileShareModal {...defaultProps} />);
    fireEvent.click(screen.getByText("Copiar link"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/u/maria"),
      );
    });
    expect(toast.default.success).toHaveBeenCalledWith("Link copiado!");
    vi.unstubAllGlobals();
  });

  it("opens WhatsApp link in a new window", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<ProfileShareModal {...defaultProps} />);
    fireEvent.click(screen.getByText("Enviar pelo WhatsApp"));

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("wa.me"),
      "_blank",
    );
    openSpy.mockRestore();
  });

  it("renders the avatar", () => {
    render(<ProfileShareModal {...defaultProps} />);
    expect(screen.getByAltText("Maria Silva")).toBeInTheDocument();
  });

  it("shows description text", () => {
    render(<ProfileShareModal {...defaultProps} />);
    expect(
      screen.getByText(
        "Escaneie o QR code ou compartilhe o link do seu perfil",
      ),
    ).toBeInTheDocument();
  });
});
