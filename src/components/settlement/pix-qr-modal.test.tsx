import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

import QRCode from "qrcode";
import { haptics } from "@/hooks/use-haptics";
import { generatePixCopiaECola } from "@/lib/pix";
import { PixQrModal } from "./pix-qr-modal";

const defaultPropsWithPixKey = {
  open: true,
  onClose: vi.fn(),
  recipientName: "Bob Santos",
  amountCents: 10000,
  pixKey: "alice@test.com" as const,
  onMarkPaid: vi.fn(),
  mode: "pay" as const,
};

const defaultPropsWithFetch = {
  open: true,
  onClose: vi.fn(),
  recipientName: "Bob Santos",
  amountCents: 10000,
  recipientUserId: "user-123",
  groupId: "group-456",
  onMarkPaid: vi.fn(),
  mode: "pay" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PixQrModal", () => {
  it("generates the QR payload from the pix key and enables copying", () => {
    render(<PixQrModal {...defaultPropsWithPixKey} />);

    expect(generatePixCopiaECola).toHaveBeenCalledWith(
      expect.objectContaining({ pixKey: "alice@test.com", amountCents: 10000 }),
    );
    expect(screen.getByRole("button", { name: /Copiar código Pix/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Já paguei/i })).toBeEnabled();
  });

  it("reports a missing pix key when the route resolves without a payload", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Destinatario sem chave Pix configurada" }),
    });

    render(<PixQrModal {...defaultPropsWithFetch} />);

    await waitFor(() => {
      expect(screen.getByText(/Não temos a chave Pix de Bob/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Copiar código Pix/i })).toBeDisabled();
  });

  it("distinguishes a transport failure from a missing pix key", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(<PixQrModal {...defaultPropsWithFetch} />);

    await waitFor(() => {
      expect(screen.getByText(/Não deu pra gerar o QR agora/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Não temos a chave Pix/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copiar código Pix/i })).toBeDisabled();

  });

  it("records the full payment when Já paguei is pressed", async () => {
    const onMarkPaid = vi.fn().mockResolvedValue(undefined);
    render(<PixQrModal {...defaultPropsWithPixKey} onMarkPaid={onMarkPaid} />);

    fireEvent.click(screen.getByRole("button", { name: /Já paguei/i }));

    await waitFor(() => {
      expect(onMarkPaid).toHaveBeenCalledWith(10000, expect.any(String));
    });
  });

  it("pays a partial amount chosen through the half chip", async () => {
    const onMarkPaid = vi.fn().mockResolvedValue(undefined);
    render(
      <PixQrModal {...defaultPropsWithPixKey} onMarkPaid={onMarkPaid} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Metade/i }));
    expect(screen.getByText(/Resta depois do Pix/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Paguei/i }));

    await waitFor(() => {
      expect(onMarkPaid).toHaveBeenCalledWith(5000, expect.any(String));
    });
  });

  it("shows the success state and completes the settlement on close", async () => {
    const onClose = vi.fn();
    const onSettlementComplete = vi.fn();
    const onMarkPaid = vi.fn().mockResolvedValue(undefined);
    render(
      <PixQrModal
        {...defaultPropsWithPixKey}
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
    render(<PixQrModal {...defaultPropsWithPixKey} onMarkPaid={onMarkPaid} />);

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
    render(<PixQrModal {...defaultPropsWithPixKey} mode="collect" />);

    expect(screen.getByText("Cobrar via Pix")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Já recebi/i })).toBeEnabled();
  });

  it("snaps slider to round amount and triggers haptic tick", () => {
    render(<PixQrModal {...defaultPropsWithPixKey} amountCents={50000} />);

    const slider = screen.getByRole("slider", { name: /Valor do pagamento/i }) as HTMLInputElement;

    fireEvent.change(slider, { target: { value: "5100" } });
    expect(screen.getByText("R$ 50,00")).toBeInTheDocument();
    expect(haptics.selectionChanged).toHaveBeenCalled();
  });

  it("renders visual tick marks for snap points", () => {
    render(
      <PixQrModal {...defaultPropsWithPixKey} amountCents={50000} />,
    );

    const ticks = document.querySelectorAll(".bg-muted-foreground\\/30");
    expect(ticks.length).toBeGreaterThan(0);
  });

  it("triggers haptics.success on copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<PixQrModal {...defaultPropsWithPixKey} />);

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
    render(<PixQrModal {...defaultPropsWithPixKey} onClose={onClose} />);

    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has role=dialog", () => {
    render(<PixQrModal {...defaultPropsWithPixKey} />);

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
            {...defaultPropsWithPixKey}
            open={open}
            onClose={() => setOpen(false)}
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

  it("POSTs to /api/pix/generate with initial amount after debounce elapses", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ copiaECola: "fetched-br-code" }),
    });
    global.fetch = mockFetch;

    render(<PixQrModal {...defaultPropsWithFetch} />);

    expect(mockFetch).not.toHaveBeenCalled();

    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/pix/generate",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipientUserId: "user-123",
              amountCents: 10000,
              groupId: "group-456",
            }),
          }),
        );
      },
      { timeout: 1000 },
    );
  });

  it("sends partial amount in request when slider is moved before debounce completes", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ copiaECola: "fetched-br-code" }),
    });
    global.fetch = mockFetch;

    render(<PixQrModal {...defaultPropsWithFetch} />);

    const slider = screen.getByRole("slider", { name: /Valor do pagamento/i }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "5000" } });

    expect(mockFetch).not.toHaveBeenCalled();

    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/pix/generate",
          expect.objectContaining({
            body: JSON.stringify({
              recipientUserId: "user-123",
              amountCents: 5000,
              groupId: "group-456",
            }),
          }),
        );
        expect(mockFetch).toHaveBeenCalledTimes(1);
      },
      { timeout: 1000 },
    );
  });

  it("never offers a payload generated for a different amount", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ copiaECola: "br-code-for-10000" }),
    });

    render(<PixQrModal {...defaultPropsWithFetch} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Copiar código Pix/i })).toBeEnabled();
    });

    vi.mocked(QRCode.toCanvas).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Metade/i }));

    expect(screen.getByRole("button", { name: /Copiar código Pix/i })).toBeDisabled();
    expect(QRCode.toCanvas).not.toHaveBeenCalledWith(
      expect.anything(),
      "br-code-for-10000",
      expect.anything(),
    );
  });

  it("keeps the payload after a failed settlement attempt", async () => {
    const onMarkPaid = vi.fn().mockRejectedValue(new LedgerError("network"));
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ copiaECola: "br-code-for-10000" }),
    });

    render(<PixQrModal {...defaultPropsWithFetch} onMarkPaid={onMarkPaid} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Copiar código Pix/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Já paguei/i }));

    await waitFor(() => {
      expect(onMarkPaid).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Copiar código Pix/i })).toBeEnabled();
    });
    expect(screen.queryByText(/Não temos a chave Pix/)).not.toBeInTheDocument();
  });

  it("repaints the QR when the amount returns to an already-fetched value", async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const { amountCents } = JSON.parse(init.body as string) as { amountCents: number };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ copiaECola: `br-code-${amountCents}` }),
      });
    });

    render(<PixQrModal {...defaultPropsWithFetch} />);

    await waitFor(() => {
      expect(QRCode.toCanvas).toHaveBeenCalledWith(
        expect.anything(),
        "br-code-10000",
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Metade/i }));
    await waitFor(() => {
      expect(QRCode.toCanvas).toHaveBeenCalledWith(
        expect.anything(),
        "br-code-5000",
        expect.anything(),
      );
    });

    vi.mocked(QRCode.toCanvas).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Tudo/i }));

    await waitFor(() => {
      expect(QRCode.toCanvas).toHaveBeenCalledWith(
        expect.anything(),
        "br-code-10000",
        expect.anything(),
      );
    });
  });
});
