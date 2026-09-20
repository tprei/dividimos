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
const toastSuccess = vi.fn();
vi.mock("react-hot-toast", () => ({
  default: {
    error: (message: string) => toastError(message),
    success: (message: string) => toastSuccess(message),
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
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
import { formatBRL } from "@/lib/currency";

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

  it("shows the recipient missing-key card with an out-of-band register CTA", async () => {
    const onMarkPaid = vi.fn().mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Destinatario sem chave Pix configurada" }),
    });

    render(<PixQrModal {...defaultPropsWithFetch} onMarkPaid={onMarkPaid} />);

    await waitFor(() => {
      expect(screen.getByText("Chave Pix não cadastrada")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Bob ainda não cadastrou uma chave Pix no Dividimos."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Copiar código Pix/i }),
    ).toBeDisabled();

    const registerButton = screen.getByRole("button", {
      name: /Registrar pagamento feito por fora/i,
    });
    expect(registerButton).toBeEnabled();
    fireEvent.click(registerButton);
    await waitFor(() => {
      expect(onMarkPaid).toHaveBeenCalledWith(10000, expect.any(String));
    });
  });

  it("shows the generation error card with retry on a transport failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(<PixQrModal {...defaultPropsWithFetch} />);

    await waitFor(() => {
      expect(
        screen.getByText("Não foi possível gerar o QR code"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("Sem conexão? Confere a internet e tenta de novo."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Tentar de novo/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Chave Pix não cadastrada/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Copiar código Pix/i }),
    ).toBeDisabled();
  });

  it("retries the generation immediately with the same amount after a failure", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Erro ao processar a chave Pix" }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ copiaECola: "fetched-br-code" }),
      });
    global.fetch = mockFetch;

    render(<PixQrModal {...defaultPropsWithFetch} />);

    await waitFor(() => {
      expect(
        screen.getByText("Não foi possível gerar o QR code"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/i }));

    // Pay mode keeps the canvas behind the disclosure, so readiness shows up
    // as an enabled copy button carrying the fresh code.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Copiar código Pix/i }),
      ).toBeEnabled();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Mostrar QR code" }),
    );
    await waitFor(() => {
      expect(QRCode.toCanvas).toHaveBeenCalledWith(
        expect.anything(),
        "fetched-br-code",
        expect.anything(),
        expect.any(Function),
      );
    }, { timeout: 3000 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const retryInit = mockFetch.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(retryInit.body as string)).toEqual({
      recipientUserId: "user-123",
      amountCents: 10000,
      groupId: "group-456",
    });
  });

  it("shows the owner missing-key card with a profile link", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Voce nao tem chave Pix configurada" }),
    });

    render(<PixQrModal {...defaultPropsWithFetch} />);

    await waitFor(() => {
      expect(screen.getByText("Cadastre sua chave Pix")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Cadastre sua chave Pix no seu perfil pra receber pagamentos."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Configurar chave Pix no perfil/i }),
    ).toHaveAttribute("href", "/app/profile");
  });

  it("reveals the selectable code when the clipboard rejects and recovers on retry", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("Clipboard blocked"))
      .mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ copiaECola: "br-code-for-10000" }),
    });

    render(<PixQrModal {...defaultPropsWithFetch} />);

    const copyButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /Copiar código Pix/i });
      expect(button).toBeEnabled();
      return button;
    });

    await act(async () => {
      copyButton.click();
    });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Não foi possível copiar. Use o código abaixo para copiar manualmente.",
      );
    });
    expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(screen.getByText("br-code-for-10000")).toBeInTheDocument();
    expect(copyButton).toBeEnabled();

    await act(async () => {
      copyButton.click();
    });

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Código Pix copiado!");
    });
    expect(haptics.success).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Copiado!")).toBeInTheDocument();
    expect(screen.queryByText("br-code-for-10000")).not.toBeInTheDocument();
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
  it("handles exact 1-centavo slider values and keyboard navigation without snapback", () => {
    render(<PixQrModal {...defaultPropsWithPixKey} amountCents={12154} />);

    const slider = screen.getByRole("slider", { name: /Valor do pagamento/i }) as HTMLInputElement;
    expect(slider).toHaveAttribute("step", "1");
    expect(slider.value).toBe("12154");
    expect(slider).toHaveAttribute("aria-valuetext", formatBRL(12154));

    // ArrowLeft from max moves to 12153 without snapping
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider.value).toBe("12153");
    expect(slider).toHaveAttribute("aria-valuetext", formatBRL(12153));
    expect(screen.getByRole("button", { name: `Editar valor, ${formatBRL(12153)}` })).toBeInTheDocument();

    // End returns to 12154
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider.value).toBe("12154");
    expect(slider).toHaveAttribute("aria-valuetext", formatBRL(12154));
    expect(screen.getByRole("button", { name: `Editar valor, ${formatBRL(12154)}` })).toBeInTheDocument();

    // Home jumps to sliderMin (100)
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider.value).toBe("100");
    expect(slider).toHaveAttribute("aria-valuetext", formatBRL(100));

    // Page keys move a tenth of the range: (12154 - 100) / 10 = 1205
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider.value).toBe("1305");
    expect(slider).toHaveAttribute("aria-valuetext", formatBRL(1305));

    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(slider.value).toBe("100");
    expect(slider).toHaveAttribute("aria-valuetext", formatBRL(100));
  });

  it("renders the Metade pill as a plain button without a midpoint snap marker", () => {
    render(<PixQrModal {...defaultPropsWithPixKey} amountCents={12154} />);

    expect(screen.getByRole("button", { name: "Metade" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tudo" })).toBeInTheDocument();

    // Metade sets the value directly; it is not a snap point the slider can land on.
    const expectedLeft = `${((6077 - 100) / (12154 - 100)) * 100}%`;
    const ticks = Array.from(document.querySelectorAll<HTMLElement>(".bg-muted-foreground\\/30"));
    expect(ticks.find((tick) => tick.style.left === expectedLeft)).toBeUndefined();
  });

  it("hides the Metade pill for totals under R$ 2,00", () => {
    render(<PixQrModal {...defaultPropsWithPixKey} amountCents={150} />);

    expect(screen.queryByRole("button", { name: /Metade/ })).not.toBeInTheDocument();
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
      expect.any(Function),
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
    expect(
      screen.queryByText(/Não foi possível gerar o QR code/),
    ).not.toBeInTheDocument();
  });

  it("refetches and repaints the QR when the amount changes", async () => {
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
      expect(screen.getByRole("button", { name: "Mostrar QR code" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Copiar código Pix/i }),
      ).toBeEnabled();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Mostrar QR code" }),
    );
    await waitFor(() => {
      expect(QRCode.toCanvas).toHaveBeenCalledWith(
        expect.anything(),
        "br-code-10000",
        expect.anything(),
        expect.any(Function),
      );
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: /Metade/i }));
    await waitFor(() => {
      expect(QRCode.toCanvas).toHaveBeenCalledWith(
        expect.anything(),
        "br-code-5000",
        expect.anything(),
        expect.any(Function),
      );
    }, { timeout: 4000 });

    vi.mocked(QRCode.toCanvas).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Tudo/i }));

    await waitFor(() => {
      expect(QRCode.toCanvas).toHaveBeenCalledWith(
        expect.anything(),
        "br-code-10000",
        expect.anything(),
        expect.any(Function),
      );
    }, { timeout: 4000 });
  });
  it("renders a visible close button while idle and dismissible", () => {
    render(<PixQrModal {...defaultPropsWithPixKey} />);

    expect(screen.getByRole("button", { name: /fechar|close/i })).toBeInTheDocument();
  });

  it("hides the close button and shows Registrando... while settling", async () => {
    const pending = Promise.withResolvers<void>();
    const onMarkPaid = vi.fn(() => pending.promise);
    render(<PixQrModal {...defaultPropsWithPixKey} onMarkPaid={onMarkPaid} />);

    fireEvent.click(screen.getByRole("button", { name: /Já paguei/i }));

    await waitFor(() => {
      expect(screen.getByText("Registrando...")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /fechar|close/i })).not.toBeInTheDocument();
  });

  it("hides the modal close button in success state and fires onClose on Fechar", async () => {
    const onClose = vi.fn();
    const onMarkPaid = vi.fn().mockResolvedValue(undefined);
    render(
      <PixQrModal
        {...defaultPropsWithPixKey}
        onClose={onClose}
        onMarkPaid={onMarkPaid}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Já paguei/i }));

    await waitFor(() => {
      expect(screen.getByText("Pagamento registrado!")).toBeInTheDocument();
    });

    const fecharButton = screen.getByRole("button", { name: "Fechar" });
    expect(fecharButton).toBeInTheDocument();
    fireEvent.click(fecharButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders amount chips enabled with aria-pressed reflecting selection", () => {
    render(<PixQrModal {...defaultPropsWithPixKey} amountCents={10000} />);

    const tudoBtn = screen.getByRole("button", { name: "Tudo" });
    const metadeBtn = screen.getByRole("button", { name: "Metade" });

    expect(tudoBtn).not.toBeDisabled();
    expect(tudoBtn).toHaveAttribute("aria-pressed", "true");
    expect(metadeBtn).not.toBeDisabled();
    expect(metadeBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(metadeBtn);

    expect(tudoBtn).toHaveAttribute("aria-pressed", "false");
    expect(metadeBtn).toHaveAttribute("aria-pressed", "true");
    expect(tudoBtn).not.toBeDisabled();
    expect(metadeBtn).not.toBeDisabled();
  });

  it("collapses the pay QR behind a disclosure with no canvas or fetch on open", () => {
    render(<PixQrModal {...defaultPropsWithPixKey} />);

    const disclosure = screen.getByRole("button", {
      name: "Mostrar QR code",
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(disclosure).toHaveAttribute("aria-controls", "pix-qr-region");
    expect(QRCode.toCanvas).not.toHaveBeenCalled();
    expect(screen.queryByText("1. Pague no app do seu banco")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Copia o código, paga no app do seu banco e volta aqui pra confirmar. Registrar não move dinheiro, só marca que você pagou.",
      ),
    ).toBeInTheDocument();
  });

  it("paints the QR on disclosure expand without issuing a fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ copiaECola: "br-code-10000" }),
    });
    global.fetch = mockFetch;
    render(<PixQrModal {...defaultPropsWithFetch} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Mostrar QR code" }),
      ).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockClear();
    vi.mocked(QRCode.toCanvas).mockClear();

    fireEvent.click(
      screen.getByRole("button", { name: "Mostrar QR code" }),
    );

    await waitFor(() => {
      expect(QRCode.toCanvas).toHaveBeenCalledTimes(1);
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Ocultar QR code/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("renders the collect QR immediately with the collect expectation line", () => {
    render(<PixQrModal {...defaultPropsWithPixKey} mode="collect" />);

    expect(QRCode.toCanvas).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: /Mostrar QR code/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("2. Registre aqui no Dividimos"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Registrar não move dinheiro, só marca que ele te pagou por fora."),
    ).toBeInTheDocument();
  });

  it("shows the pay expectation line in pay mode", () => {
    render(<PixQrModal {...defaultPropsWithPixKey} />);

    expect(
      screen.queryByText("2. Registre aqui no Dividimos"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Lê o QR code/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sem QR code/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Copia o código, paga no app do seu banco e volta aqui pra confirmar. Registrar não move dinheiro, só marca que você pagou.",
      ),
    ).toBeInTheDocument();
  });
});
