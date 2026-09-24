import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { qrToCanvas } from "@/lib/qr";
import { QuickChargeModal } from "./quick-charge-modal";
import { useAppStore } from "@/stores/app-store";

vi.mock("@/lib/qr", () => ({
  qrToCanvas: vi.fn(() => Promise.resolve()),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
    tap: vi.fn(),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: {
    error: (message: string) => toastError(message),
    success: (message: string) => toastSuccess(message),
  },
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  recordVendorCharge: vi.fn(async (amountCents: number, description: string | null) => ({
    id: "charge-123",
    userId: "user-me",
    amountCents,
    description,
    status: "pending" as const,
    createdAt: "2026-09-06T12:00:00Z",
    confirmedAt: null,
  })),
  cancelVendorCharge: vi.fn(async () => {}),
  confirmVendorCharge: vi.fn(async (chargeId: string) => ({
    id: chargeId,
    userId: "user-me",
    amountCents: 2000,
    description: "Taxa",
    status: "received" as const,
    createdAt: "2026-09-06T12:00:00Z",
    confirmedAt: "2026-09-06T12:05:00Z",
  })),
}));

import {
  cancelVendorCharge,
  confirmVendorCharge,
  recordVendorCharge,
} from "@/lib/sync/mutations-group";

vi.mock("@/lib/sync/pix", () => ({
  generateSelfPixCode: vi.fn(),
}));

import { generateSelfPixCode } from "@/lib/sync/pix";

import { haptics } from "@/hooks/use-haptics";

describe("QuickChargeModal", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    vi.clearAllMocks();
    vi.mocked(generateSelfPixCode).mockResolvedValue("00020126580014br.gov.bcb.pix");
  });

  it("does not render when open is false", () => {
    render(<QuickChargeModal anchor={null} open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "Cobrar rápido" })).not.toBeInTheDocument();
  });


  it("generates QR code and upserts recorded charge into store", async () => {
    render(<QuickChargeModal anchor={null} open={true} onClose={vi.fn()} />);

    const descInput = screen.getByPlaceholderText("Descrição (opcional)");
    fireEvent.change(descInput, { target: { value: "Ingresso" } });

    const quickAddButton = screen.getByRole("button", { name: "Adicionar R$20" });
    fireEvent.click(quickAddButton);

    const generateButton = screen.getByRole("button", { name: "Gerar QR" });
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(recordVendorCharge).toHaveBeenCalledWith(2000, "Ingresso");
    });

    await waitFor(() => {
      expect(screen.getByText("Copiar código Pix")).toBeInTheDocument();
    });

    const storeCharges = useAppStore.getState().vendorCharges;
    expect(storeCharges).toHaveLength(1);
    expect(storeCharges[0].id).toBe("charge-123");
    expect(storeCharges[0].status).toBe("pending");
  });

  it("paints the code onto the canvas the QR phase mounts", async () => {
    render(<QuickChargeModal anchor={null} open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR" }));

    // The canvas only exists once this phase renders, so a payload-keyed
    // effect would have run too early and left an empty white box.
    await waitFor(() => {
      expect(qrToCanvas).toHaveBeenCalledWith(
        expect.anything(),
        "00020126580014br.gov.bcb.pix",
        expect.anything(),
      );
    });
  });

  it("confirms charge and upserts confirmed charge into store", async () => {
    const onConfirmed = vi.fn();
    render(
      <QuickChargeModal
        anchor={null}
        open={true}
        onClose={vi.fn()}
        onChargeConfirmed={onConfirmed}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR" }));

    await waitFor(() => {
      expect(screen.getByText(/Já recebi/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Já recebi/i));

    await waitFor(() => {
      expect(confirmVendorCharge).toHaveBeenCalledWith("charge-123");
    });

    const storeCharges = useAppStore.getState().vendorCharges;
    expect(storeCharges[0].status).toBe("received");
  });
  it("does not insert when the modal closes before Pix generation resolves", async () => {
    const { promise: codePromise, resolve: resolveCode } = Promise.withResolvers<string>();
    vi.mocked(generateSelfPixCode).mockImplementationOnce(() => codePromise);

    const view = render(<QuickChargeModal anchor={null} open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR" }));
    await waitFor(() => expect(generateSelfPixCode).toHaveBeenCalledTimes(1));

    view.rerender(<QuickChargeModal anchor={null} open={false} onClose={vi.fn()} />);
    resolveCode("00020126580014br.gov.bcb.pix");

    await waitFor(() => expect(recordVendorCharge).not.toHaveBeenCalled());
  });
  it("does not insert when the component unmounts before Pix generation resolves", async () => {
    const { promise: codePromise, resolve: resolveCode } = Promise.withResolvers<string>();
    vi.mocked(generateSelfPixCode).mockImplementationOnce(() => codePromise);

    const view = render(<QuickChargeModal anchor={null} open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR" }));
    await waitFor(() => expect(generateSelfPixCode).toHaveBeenCalledTimes(1));

    view.unmount();
    resolveCode("00020126580014br.gov.bcb.pix");

    await waitFor(() => expect(recordVendorCharge).not.toHaveBeenCalled());
  });

  it("cancels an insert that resolves after modal close", async () => {
    const insert = Promise.withResolvers<{
      id: string;
      userId: string;
      amountCents: number;
      description: string | null;
      status: "pending";
      createdAt: string;
      confirmedAt: null;
    }>();
    vi.mocked(recordVendorCharge).mockImplementationOnce(() => insert.promise);

    const view = render(<QuickChargeModal anchor={null} open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR" }));
    await waitFor(() => expect(recordVendorCharge).toHaveBeenCalledTimes(1));

    view.rerender(<QuickChargeModal anchor={null} open={false} onClose={vi.fn()} />);
    insert.resolve({
      id: "charge-late",
      userId: "user-me",
      amountCents: 2000,
      description: null,
      status: "pending",
      createdAt: "2026-09-06T12:00:00Z",
      confirmedAt: null,
    });

    await waitFor(() =>
      expect(cancelVendorCharge).toHaveBeenCalledWith("charge-late"),
    );
  });

  it("cancels a deferred insert when the user changes the amount", async () => {
    const insert = Promise.withResolvers<{
      id: string;
      userId: string;
      amountCents: number;
      description: string | null;
      status: "pending";
      createdAt: string;
      confirmedAt: null;
    }>();
    vi.mocked(recordVendorCharge).mockImplementationOnce(() => insert.promise);

    render(<QuickChargeModal anchor={null} open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR" }));
    await waitFor(() => expect(recordVendorCharge).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Alterar valor" }));
    insert.resolve({
      id: "charge-changed",
      userId: "user-me",
      amountCents: 2000,
      description: null,
      status: "pending",
      createdAt: "2026-09-06T12:00:00Z",
      confirmedAt: null,
    });

    await waitFor(() =>
      expect(cancelVendorCharge).toHaveBeenCalledWith("charge-changed"),
    );
  });

  it("shows a visible error when deferred cancellation fails", async () => {
    const insert = Promise.withResolvers<{
      id: string;
      userId: string;
      amountCents: number;
      description: string | null;
      status: "pending";
      createdAt: string;
      confirmedAt: null;
    }>();
    vi.mocked(recordVendorCharge).mockImplementationOnce(() => insert.promise);
    vi.mocked(cancelVendorCharge).mockRejectedValueOnce(new Error("falha"));

    render(<QuickChargeModal anchor={null} open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR" }));
    await waitFor(() => expect(recordVendorCharge).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Alterar valor" }));
    insert.resolve({
      id: "charge-failed-cancel",
      userId: "user-me",
      amountCents: 2000,
      description: null,
      status: "pending",
      createdAt: "2026-09-06T12:00:00Z",
      confirmedAt: null,
    });

    expect(
      await screen.findByText("Não foi possível cancelar a cobrança. Tente novamente."),
    ).toBeInTheDocument();
  });

  it("waits for the exact insert before confirming and does not duplicate it", async () => {
    const insert = Promise.withResolvers<{
      id: string;
      userId: string;
      amountCents: number;
      description: string | null;
      status: "pending";
      createdAt: string;
      confirmedAt: null;
    }>();
    vi.mocked(recordVendorCharge).mockImplementationOnce(() => insert.promise);

    render(<QuickChargeModal anchor={null} open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR" }));
    await waitFor(() => expect(recordVendorCharge).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText(/Já recebi/i));
    expect(confirmVendorCharge).not.toHaveBeenCalled();

    insert.resolve({
      id: "charge-confirm",
      userId: "user-me",
      amountCents: 2000,
      description: null,
      status: "pending",
      createdAt: "2026-09-06T12:00:00Z",
      confirmedAt: null,
    });

    await waitFor(() => expect(confirmVendorCharge).toHaveBeenCalledWith("charge-confirm"));
    expect(recordVendorCharge).toHaveBeenCalledTimes(1);
  });
  it("allows retrying confirmation after a failed request", async () => {
    vi.mocked(confirmVendorCharge).mockRejectedValueOnce(new Error("offline"));

    render(<QuickChargeModal anchor={null} open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR" }));
    await waitFor(() => expect(screen.getByText(/Já recebi/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/Já recebi/i));
    await waitFor(() =>
      expect(confirmVendorCharge).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(screen.getByText(/Já recebi/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/Já recebi/i));
    await waitFor(() =>
      expect(confirmVendorCharge).toHaveBeenCalledTimes(2),
    );
    expect(useAppStore.getState().vendorCharges[0].status).toBe("received");
  });

  it("falls back to a selectable code and keeps copy enabled when the clipboard rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard blocked"));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<QuickChargeModal anchor={null} open={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR" }));

    const copyButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /Copiar código Pix/i });
      expect(button).toBeEnabled();
      return button;
    });

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Não foi possível copiar. Use o código abaixo para copiar manualmente.",
      );
    });
    expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(screen.getByText("00020126580014br.gov.bcb.pix")).toBeInTheDocument();
    expect(copyButton).toBeEnabled();
  });

  it("copies the code with success haptic when the clipboard resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<QuickChargeModal anchor={null} open={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar QR" }));

    const copyButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /Copiar código Pix/i });
      expect(button).toBeEnabled();
      return button;
    });

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("00020126580014br.gov.bcb.pix");
    });
    expect(haptics.success).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Copiado!")).toBeInTheDocument();
  });
});
