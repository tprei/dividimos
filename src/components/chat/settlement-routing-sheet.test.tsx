import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("@/components/settlement/pix-qr-modal", () => ({
  PixQrModal: (props: Record<string, unknown>) =>
    props.open
      ? React.createElement(
          "div",
          { "data-testid": "pix-modal" },
          `amount=${props.amountCents} group=${props.groupId}`,
        )
      : null,
}));

vi.mock("@/lib/supabase/settlement-actions", () => ({
  recordSettlement: vi.fn().mockResolvedValue({ id: "s1", status: "confirmed" }),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? React.createElement("div", { "data-testid": "sheet" }, children) : null,
  SheetContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "sheet-content" }, children),
  SheetHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  SheetTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h2", null, children),
  SheetDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement("p", null, children),
}));

import { SettlementRoutingSheet } from "./settlement-routing-sheet";
import type { GroupDebt } from "@/lib/supabase/cross-group-settlement";

const FROM_USER = "user-1";
const TO_USER = "user-2";

const singleDebt: GroupDebt[] = [
  { groupId: "g1", groupName: "Viagem SP", amountCents: -2500 },
];

const multipleDebts: GroupDebt[] = [
  { groupId: "g1", groupName: "Viagem SP", amountCents: -2500 },
  { groupId: "g2", groupName: "Almoço", amountCents: -1250 },
];

function defaultProps(debts: GroupDebt[]) {
  return {
    open: true,
    onClose: vi.fn(),
    fromUserId: FROM_USER,
    toUserId: TO_USER,
    toUserName: "Alice",
    debts,
  };
}

describe("SettlementRoutingSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the sheet when open", () => {
    render(<SettlementRoutingSheet {...defaultProps(singleDebt)} />);
    expect(screen.getByTestId("sheet")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <SettlementRoutingSheet {...defaultProps(singleDebt)} open={false} />,
    );
    expect(screen.queryByTestId("sheet")).not.toBeInTheDocument();
  });

  it("shows recipient name in title", () => {
    render(<SettlementRoutingSheet {...defaultProps(singleDebt)} />);
    expect(screen.getByText("Pagar Alice")).toBeInTheDocument();
  });

  it("shows total amount owed in description", () => {
    render(<SettlementRoutingSheet {...defaultProps(singleDebt)} />);
    expect(screen.getByText(/Você deve.*R\$ 25,00/)).toBeInTheDocument();
  });

  it("renders each owed group as a row", () => {
    render(<SettlementRoutingSheet {...defaultProps(multipleDebts)} />);
    expect(screen.getByText("Viagem SP")).toBeInTheDocument();
    expect(screen.getByText("Almoço")).toBeInTheDocument();
  });

  it("shows 'Pagar tudo' button when multiple groups", () => {
    render(<SettlementRoutingSheet {...defaultProps(multipleDebts)} />);
    expect(screen.getByText(/Pagar tudo/)).toBeInTheDocument();
  });

  it("does not show 'Pagar tudo' button with single group", () => {
    render(<SettlementRoutingSheet {...defaultProps(singleDebt)} />);
    expect(screen.queryByText(/Pagar tudo/)).not.toBeInTheDocument();
  });

  it("opens PixQrModal when per-group Pagar button is clicked", async () => {
    const user = userEvent.setup();
    render(<SettlementRoutingSheet {...defaultProps(multipleDebts)} />);

    const payButtons = screen.getAllByText(/Pagar R\$/);
    await user.click(payButtons[0]);

    expect(screen.getByTestId("pix-modal")).toBeInTheDocument();
    expect(screen.getByTestId("pix-modal").textContent).toContain("amount=2500");
    expect(screen.getByTestId("pix-modal").textContent).toContain("group=g1");
  });

  it("opens PixQrModal for total when 'Pagar tudo' is clicked", async () => {
    const user = userEvent.setup();
    render(<SettlementRoutingSheet {...defaultProps(multipleDebts)} />);

    await user.click(screen.getByText(/Pagar tudo/));

    expect(screen.getByTestId("pix-modal")).toBeInTheDocument();
    expect(screen.getByTestId("pix-modal").textContent).toContain("amount=3750");
  });

  it("excludes debts where counterparty owes user", () => {
    const mixedDebts: GroupDebt[] = [
      { groupId: "g1", groupName: "Viagem SP", amountCents: -2500 },
      { groupId: "g2", groupName: "Jantar", amountCents: 1000 },
    ];
    render(<SettlementRoutingSheet {...defaultProps(mixedDebts)} />);
    expect(screen.getByText("Viagem SP")).toBeInTheDocument();
    expect(screen.queryByText("Jantar")).not.toBeInTheDocument();
  });
});
