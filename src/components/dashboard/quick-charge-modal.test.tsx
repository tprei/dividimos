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
  recordVendorCharge,
  confirmVendorCharge,
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
});
