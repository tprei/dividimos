import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChargeHistoryList } from "./charge-history-list";
import { useAppStore } from "@/stores/app-store";
import type { VendorCharge } from "@/types/ledger";

vi.mock("@/lib/sync/refresh", () => ({
  loadVendorCharges: vi.fn(async () => {}),
}));

import { loadVendorCharges } from "@/lib/sync/refresh";

describe("ChargeHistoryList", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    vi.clearAllMocks();
  });

  it("calls loadVendorCharges on mount", () => {
    render(<ChargeHistoryList />);
    expect(loadVendorCharges).toHaveBeenCalledTimes(1);
  });

  it("renders empty state when there are no charges", () => {
    render(<ChargeHistoryList />);
    expect(screen.getByText("Nenhuma cobrança ainda")).toBeInTheDocument();
    expect(
      screen.getByText(/Use o "Cobrar rápido" na tela inicial/i),
    ).toBeInTheDocument();
  });

  it("renders charges from store with amount and status", () => {
    const charge1: VendorCharge = {
      id: "vc-1",
      userId: "u-1",
      amountCents: 2500,
      description: "Almoço",
      status: "received",
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
    };
    const charge2: VendorCharge = {
      id: "vc-2",
      userId: "u-1",
      amountCents: 1500,
      description: "Café",
      status: "pending",
      createdAt: new Date().toISOString(),
      confirmedAt: null,
    };

    useAppStore.getState().applyChargePage(
      {
        charges: [charge1, charge2],
        nextCursor: null,
        complete: true,
        total: 2,
        receivedCount: 1,
        receivedTodayCents: charge1.amountCents,
      },
      true,
    );
    render(<ChargeHistoryList />);

    expect(screen.getByText("Cobranças recebidas")).toBeInTheDocument();
    expect(screen.getByText("Almoço")).toBeInTheDocument();
    expect(screen.getByText("Café")).toBeInTheDocument();
    expect(screen.getByText("Recebido")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText("Recebido hoje")).toBeInTheDocument();
    expect(screen.getByText(/1 recebida de 2 cobranças/i)).toBeInTheDocument();
  });

  it("reports the server's counts rather than the loaded page", () => {
    const charge: VendorCharge = {
      id: "vc-3",
      userId: "u-1",
      amountCents: 5000,
      description: "Jantar",
      status: "received",
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
    };

    useAppStore.getState().applyChargePage(
      {
        charges: [charge],
        nextCursor: { createdAt: charge.createdAt, id: charge.id },
        complete: false,
        total: 64,
        receivedCount: 31,
        receivedTodayCents: 12_345,
      },
      true,
    );
    render(<ChargeHistoryList />);

    expect(screen.getByText("Jantar")).toBeInTheDocument();
    expect(screen.getByText(/31 recebidas de 64 cobranças/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carregar mais" })).toBeInTheDocument();
  });
});
