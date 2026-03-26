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
});
