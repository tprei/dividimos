import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QuickChargeModal } from "./quick-charge-modal";
import { useAppStore } from "@/stores/app-store";

vi.mock("qrcode", () => ({
  default: {
    toCanvas: vi.fn(),
  },
}));

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    success: vi.fn(),
    error: vi.fn(),
    selection: vi.fn(),
    light: vi.fn(),
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

describe("QuickChargeModal", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    vi.clearAllMocks();
  });

  it("does not render when open is false", () => {
    render(<QuickChargeModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByText("Cobrar rápido")).not.toBeInTheDocument();
  });

  it("renders input phase when open", () => {
    render(<QuickChargeModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText("Cobrar rápido")).toBeInTheDocument();
    expect(screen.getByText("Gerar QR Code")).toBeInTheDocument();
  });

  it("generates QR code and upserts recorded charge into store", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ copiaECola: "00020126580014br.gov.bcb.pix" }),
    });

    render(<QuickChargeModal open={true} onClose={vi.fn()} />);

    const descInput = screen.getByPlaceholderText("Descrição (opcional)");
    fireEvent.change(descInput, { target: { value: "Ingresso" } });

    const quickAddButton = screen.getByRole("button", { name: "Adicionar R$20" });
    fireEvent.click(quickAddButton);

    const generateButton = screen.getByText("Gerar QR Code");
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

  it("confirms charge and upserts confirmed charge into store", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ copiaECola: "00020126580014br.gov.bcb.pix" }),
    });

    const onConfirmed = vi.fn();
    render(
      <QuickChargeModal
        open={true}
        onClose={vi.fn()}
        onChargeConfirmed={onConfirmed}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByText("Gerar QR Code"));

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
    const { promise: jsonPromise, resolve: resolveJson } =
      Promise.withResolvers<{ copiaECola: string }>();
    global.fetch = vi.fn().mockResolvedValueOnce({ json: () => jsonPromise });

    const view = render(<QuickChargeModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByText("Gerar QR Code"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    view.rerender(<QuickChargeModal open={false} onClose={vi.fn()} />);
    resolveJson({ copiaECola: "00020126580014br.gov.bcb.pix" });

    await waitFor(() => expect(recordVendorCharge).not.toHaveBeenCalled());
  });
  it("does not insert when the component unmounts before Pix generation resolves", async () => {
    const { promise: jsonPromise, resolve: resolveJson } =
      Promise.withResolvers<{ copiaECola: string }>();
    global.fetch = vi.fn().mockResolvedValueOnce({ json: () => jsonPromise });

    const view = render(<QuickChargeModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByText("Gerar QR Code"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    view.unmount();
    resolveJson({ copiaECola: "00020126580014br.gov.bcb.pix" });

    await waitFor(() => expect(recordVendorCharge).not.toHaveBeenCalled());
  });

  it("cancels an insert that resolves after modal close", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ copiaECola: "00020126580014br.gov.bcb.pix" }),
    });
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

    const view = render(<QuickChargeModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByText("Gerar QR Code"));
    await waitFor(() => expect(recordVendorCharge).toHaveBeenCalledTimes(1));

    view.rerender(<QuickChargeModal open={false} onClose={vi.fn()} />);
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
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ copiaECola: "00020126580014br.gov.bcb.pix" }),
    });
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

    render(<QuickChargeModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByText("Gerar QR Code"));
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
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ copiaECola: "00020126580014br.gov.bcb.pix" }),
    });
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

    render(<QuickChargeModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByText("Gerar QR Code"));
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
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ copiaECola: "00020126580014br.gov.bcb.pix" }),
    });
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

    render(<QuickChargeModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar R$20" }));
    fireEvent.click(screen.getByText("Gerar QR Code"));
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
});
