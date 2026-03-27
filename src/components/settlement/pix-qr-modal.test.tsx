import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock framer-motion to render children directly
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    span: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
      <span {...props}>{children}</span>
    ),
  },
}));

// Mock QRCode
vi.mock("qrcode", () => ({
  default: { toCanvas: vi.fn() },
}));

// Mock pix generation
vi.mock("@/lib/pix", () => ({
  generatePixCopiaECola: vi.fn(() => "pix-payload"),
}));

import { PixQrModal } from "./pix-qr-modal";

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  recipientName: "Bob Santos",
  amountCents: 10000,
  onMarkPaid: vi.fn(),
  mode: "pay" as const,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("PixQrModal", () => {
  it("shows inline error message when API returns error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: "Erro ao processar chave Pix do destinatario" }),
    });

    render(
      <PixQrModal
        {...defaultProps}
        recipientUserId="user-bob"
        billId="bill-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Erro ao processar chave Pix do destinatario")).toBeInTheDocument();
    });
  });

  it("shows connection error on fetch failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(
      <PixQrModal
        {...defaultProps}
        recipientUserId="user-bob"
        billId="bill-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Erro de conexao. Tente novamente.")).toBeInTheDocument();
    });
  });

  it("disables copy button when there is an error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: "Erro ao processar chave Pix do destinatario" }),
    });

    render(
      <PixQrModal
        {...defaultProps}
        recipientUserId="user-bob"
        billId="bill-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Erro ao processar chave Pix do destinatario")).toBeInTheDocument();
    });

    const copyButton = screen.getByRole("button", { name: /Copiar Pix Copia e Cola/i });
    expect(copyButton).toBeDisabled();
  });

  it("renders QR code area when API succeeds", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ copiaECola: "00020126580014br.gov.bcb.pix...test" }),
    });

    render(
      <PixQrModal
        {...defaultProps}
        recipientUserId="user-bob"
        billId="bill-1"
      />,
    );

    await waitFor(() => {
      const copyButton = screen.getByRole("button", { name: /Copiar Pix Copia e Cola/i });
      expect(copyButton).not.toBeDisabled();
    });

    // No error message should be present
    expect(screen.queryByText(/Erro/)).not.toBeInTheDocument();
  });

  describe("slider input", () => {
    it("renders a range slider when modal is open", () => {
      render(
        <PixQrModal
          {...defaultProps}
          pixKey="test@pix.com"
        />,
      );

      const slider = screen.getByRole("slider", { name: /ajustar valor/i });
      expect(slider).toBeInTheDocument();
      expect(slider).toHaveAttribute("min", "1");
      expect(slider).toHaveAttribute("max", "10000");
    });

    it("slider value syncs with the text input", () => {
      render(
        <PixQrModal
          {...defaultProps}
          pixKey="test@pix.com"
          amountCents={50000}
        />,
      );

      const slider = screen.getByRole("slider", { name: /ajustar valor/i });
      expect(slider).toHaveValue("50000");

      const textInput = screen.getByRole("textbox", { name: /valor do pagamento/i });
      expect(textInput).toHaveValue("500,00");
    });

    it("updates text input when slider changes", async () => {
      const { default: userEvent } = await import("@testing-library/user-event");
      const user = userEvent.setup();

      render(
        <PixQrModal
          {...defaultProps}
          pixKey="test@pix.com"
          amountCents={10000}
        />,
      );

      const slider = screen.getByRole("slider", { name: /ajustar valor/i });
      // Simulate changing the slider via fireEvent since userEvent doesn't support range well
      const { fireEvent } = await import("@testing-library/react");
      fireEvent.change(slider, { target: { value: "5000" } });

      const textInput = screen.getByRole("textbox", { name: /valor do pagamento/i });
      expect(textInput).toHaveValue("50,00");
    });

    it("does not render slider when remainingCents is 0", () => {
      render(
        <PixQrModal
          {...defaultProps}
          pixKey="test@pix.com"
          amountCents={10000}
          paidAmountCents={10000}
        />,
      );

      expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    });

    it("clamps slider value to remainingCents with partial payment", () => {
      render(
        <PixQrModal
          {...defaultProps}
          pixKey="test@pix.com"
          amountCents={10000}
          paidAmountCents={3000}
        />,
      );

      const slider = screen.getByRole("slider", { name: /ajustar valor/i });
      expect(slider).toHaveAttribute("max", "7000");
      expect(slider).toHaveValue("7000");
    });
  });
});
