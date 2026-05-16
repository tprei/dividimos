import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useState } from "react";

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

// Mock haptics
vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

import { haptics } from "@/hooks/use-haptics";
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
  vi.mocked(haptics.success).mockClear();
  vi.mocked(haptics.error).mockClear();
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
      expect(screen.getByText("Sem conexão. Tenta de novo.")).toBeInTheDocument();
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

    const copyButton = screen.getByRole("button", { name: /Copiar código Pix/i });
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
      const copyButton = screen.getByRole("button", { name: /Copiar código Pix/i });
      expect(copyButton).not.toBeDisabled();
    });

    // No error message should be present
    expect(screen.queryByText(/Erro/)).not.toBeInTheDocument();
  });

  it("triggers haptics.success on copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<PixQrModal {...defaultProps} pixKey="alice@test.com" />);

    await waitFor(() => {
      const copyButton = screen.getByRole("button", { name: /Copiar código Pix/i });
      expect(copyButton).not.toBeDisabled();
    });

    const copyButton = screen.getByRole("button", { name: /Copiar código Pix/i });
    copyButton.click();

    await waitFor(() => {
      expect(haptics.success).toHaveBeenCalledTimes(1);
    });
  });

  it("triggers haptics.error on API error response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: "No Pix key" }),
    });

    render(
      <PixQrModal
        {...defaultProps}
        recipientUserId="user-bob"
        billId="bill-1"
      />,
    );

    await waitFor(() => {
      expect(haptics.error).toHaveBeenCalled();
    });
  });

  it("triggers haptics.error on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(
      <PixQrModal
        {...defaultProps}
        recipientUserId="user-bob"
        billId="bill-1"
      />,
    );

    await waitFor(() => {
      expect(haptics.error).toHaveBeenCalled();
    });
  });

  it("snaps slider to round amount and triggers haptic tick", () => {
    render(<PixQrModal {...defaultProps} amountCents={50000} pixKey="key@test.com" />);

    const slider = screen.getByRole("slider", { name: /Valor do pagamento/i });

    // Move slider near R$ 50.00 (5000 centavos) — should snap
    fireEvent.change(slider, { target: { value: "5100" } });
    expect(slider).toHaveValue("5000");
    expect(haptics.selectionChanged).toHaveBeenCalled();
  });

  it("renders visual tick marks for snap points", () => {
    render(
      <PixQrModal {...defaultProps} amountCents={50000} pixKey="key@test.com" />,
    );

    // Snap points at multiples of R$ 5 for a R$ 500 range — should have tick marks.
    // Dialog renders via Portal so ticks are outside the render container.
    const ticks = document.querySelectorAll(".bg-muted-foreground\\/30");
    expect(ticks.length).toBeGreaterThan(0);
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    render(<PixQrModal {...defaultProps} onClose={onClose} pixKey="key@test.com" />);

    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has role=dialog", () => {
    render(<PixQrModal {...defaultProps} pixKey="key@test.com" />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
  });

  it("focus enters dialog on open", async () => {
    render(<PixQrModal {...defaultProps} pixKey="key@test.com" />);

    const dialog = screen.getByRole("dialog");

    await waitFor(() => {
      expect(dialog).toBeInTheDocument();
    });

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("focus returns to trigger on close", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Abrir</button>
          <PixQrModal
            {...defaultProps}
            open={open}
            onClose={() => setOpen(false)}
            pixKey="key@test.com"
          />
        </>
      );
    }

    const { getByText } = render(<Harness />);
    const triggerButton = getByText("Abrir") as HTMLButtonElement;
    triggerButton.focus();
    act(() => { triggerButton.click(); });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(document.activeElement).toBe(triggerButton);
  });
});
