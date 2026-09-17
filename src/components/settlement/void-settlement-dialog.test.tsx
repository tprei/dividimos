import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoidSettlementDialog } from "./void-settlement-dialog";

describe("VoidSettlementDialog", () => {
  it("capitalises the sentence head when the payer is the viewer", () => {
    render(
      <VoidSettlementDialog
        open
        amountCents={3500}
        payerName="você"
        recipientName="Bob"
        busy={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("Você pagou Bob.")).toBeInTheDocument();
    expect(screen.queryByText("você pagou Bob.")).toBeNull();
  });

  it("keeps an already capitalised payer name untouched", () => {
    render(
      <VoidSettlementDialog
        open
        amountCents={3500}
        payerName="Bob"
        recipientName="você"
        busy={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("Bob pagou você.")).toBeInTheDocument();
  });

  it("disables both footer buttons and shows Desfazendo… while busy", () => {
    render(
      <VoidSettlementDialog
        open
        amountCents={3500}
        payerName="você"
        recipientName="Bob"
        busy
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Desfazendo…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  });
});
