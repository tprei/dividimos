import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useState } from "react";
import { LedgerError } from "@/lib/sync/errors";

vi.mock("qrcode", () => ({
  default: { toCanvas: vi.fn() },
}));

vi.mock("@/lib/pix", () => ({
  generatePixCopiaECola: vi.fn(() => "pix-payload"),
}));

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

const toastError = vi.fn();
vi.mock("react-hot-toast", () => ({
  default: {
    error: (message: string) => toastError(message),
    success: vi.fn(),
  },
}));

vi.mock("@/components/shared/animated-checkmark", () => ({
  AnimatedCheckmark: () => null,
}));

vi.mock("@/components/shared/confetti-burst", () => ({
  ConfettiBurst: () => null,
}));

import { haptics } from "@/hooks/use-haptics";
import { generatePixCopiaECola } from "@/lib/pix";
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
  vi.clearAllMocks();
});

describe("PixQrModal", () => {
  it("generates the QR payload from the pix key and enables copying", () => {
    render(<PixQrModal {...defaultProps} pixKey="alice@test.com" />);

    expect(generatePixCopiaECola).toHaveBeenCalledWith(
      expect.objectContaining({ pixKey: "alice@test.com", amountCents: 10000 }),
    );
    expect(screen.getByRole("button", { name: /Copiar código Pix/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Já paguei/i })).toBeEnabled();
  });

  it("falls back to copy-only state without a pix key", () => {
    render(<PixQrModal {...defaultProps} />);

    expect(generatePixCopiaECola).not.toHaveBeenCalled();
    expect(screen.getByText(/Não temos a chave Pix de Bob/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copiar código Pix/i })).toBeDisabled();
    expect(screen.getByText(/Combine o pagamento por fora/)).toBeInTheDocument();
  });

  it("records the full payment when Já paguei is pressed", async () => {
    const onMarkPaid = vi.fn().mockResolvedValue(undefined);
    render(<PixQrModal {...defaultProps} pixKey="key@test.com" onMarkPaid={onMarkPaid} />);

    fireEvent.click(screen.getByRole("button", { name: /Já paguei/i }));

    await waitFor(() => {
      expect(onMarkPaid).toHaveBeenCalledWith(10000);
    });
  });

  it("pays a partial amount chosen through the half chip", async () => {
    const onMarkPaid = vi.fn().mockResolvedValue(undefined);
    render(
      <PixQrModal {...defaultProps} pixKey="key@test.com" onMarkPaid={onMarkPaid} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Metade/i }));
    expect(screen.getByText(/Resta depois do Pix/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Paguei/i }));

    await waitFor(() => {
      expect(onMarkPaid).toHaveBeenCalledWith(5000);
    });
  });

  it("shows the success state and completes the settlement on close", async () => {
    const onClose = vi.fn();
    const onSettlementComplete = vi.fn();
    const onMarkPaid = vi.fn().mockResolvedValue(undefined);
    render(
      <PixQrModal
        {...defaultProps}
        pixKey="key@test.com"
        onClose={onClose}
        onSettlementComplete={onSettlementComplete}
        onMarkPaid={onMarkPaid}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Já paguei/i }));

    await waitFor(() => {
      expect(screen.getByText("Pagamento registrado!")).toBeInTheDocument();
    });
    expect(screen.getByText("R$ 100,00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Fechar/i }));

    expect(onSettlementComplete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the modal open with a toast when marking paid fails", async () => {
    const onMarkPaid = vi.fn().mockRejectedValue(new LedgerError("network"));
    render(<PixQrModal {...defaultProps} pixKey="key@test.com" onMarkPaid={onMarkPaid} />);

    fireEvent.click(screen.getByRole("button", { name: /Já paguei/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Sem conexão. Tente de novo quando a internet voltar.",
      );
    });
    expect(screen.queryByText("Pagamento registrado!")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Já paguei/i })).toBeEnabled();
  });

  it("asks for receipt confirmation in collect mode", () => {
    render(<PixQrModal {...defaultProps} mode="collect" pixKey="key@test.com" />);

    expect(screen.getByText("Cobrar via Pix")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Já recebi/i })).toBeEnabled();
  });

  it("snaps slider to round amount and triggers haptic tick", () => {
    render(<PixQrModal {...defaultProps} amountCents={50000} pixKey="key@test.com" />);

    const slider = screen.getByRole("slider", { name: /Valor do pagamento/i }) as HTMLInputElement;

    fireEvent.change(slider, { target: { value: "5100" } });
    expect(screen.getByText("R$ 50,00")).toBeInTheDocument();
    expect(haptics.selectionChanged).toHaveBeenCalled();
  });

  it("renders visual tick marks for snap points", () => {
    render(
      <PixQrModal {...defaultProps} amountCents={50000} pixKey="key@test.com" />,
    );

    const ticks = document.querySelectorAll(".bg-muted-foreground\\/30");
    expect(ticks.length).toBeGreaterThan(0);
  });

  it("triggers haptics.success on copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<PixQrModal {...defaultProps} pixKey="alice@test.com" />);

    const copyButton = screen.getByRole("button", { name: /Copiar código Pix/i });
    await act(async () => {
      copyButton.click();
    });

    await waitFor(() => {
      expect(haptics.success).toHaveBeenCalledTimes(1);
    });
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

  it("resolves BR Code payload via fetchPayload when pixKey is absent", async () => {
    const fetchPayload = vi.fn().mockResolvedValue("brcode-from-route");
    render(
      <PixQrModal
        {...defaultProps}
        fetchPayload={fetchPayload}
      />,
    );

    await waitFor(() => {
      expect(fetchPayload).toHaveBeenCalled();
    });
  });
});
