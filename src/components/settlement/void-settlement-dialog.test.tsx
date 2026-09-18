import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoidSettlementDialog } from "./void-settlement-dialog";

describe("VoidSettlementDialog", () => {
  it("renders the new title, note without em dash, payer and recipient names, and amount", () => {
    render(
      <VoidSettlementDialog
        open
        amountCents={3500}
        payerName="Alice"
        recipientName="Bob"
        busy={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("Desfazer este registro?")).toBeInTheDocument();
    expect(
      screen.getByText("O registro fica marcado como Desfeito e os saldos são recalculados na hora."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("O Pix em si não é estornado. Combina a devolução direto com a outra pessoa."),
    ).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("R$ 35,00")).toBeInTheDocument();
  });

  it("calls onSkipFutureConfirmations before onConfirm when checkbox is checked", () => {
    const onSkipFutureConfirmations = vi.fn();
    const onConfirm = vi.fn();
    const calls: string[] = [];

    onSkipFutureConfirmations.mockImplementation(() => {
      calls.push("skip");
    });
    onConfirm.mockImplementation(() => {
      calls.push("confirm");
    });

    render(
      <VoidSettlementDialog
        open
        amountCents={5000}
        payerName="Alice"
        recipientName="Bob"
        busy={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        onSkipFutureConfirmations={onSkipFutureConfirmations}
      />,
    );

    const checkbox = screen.getByLabelText("Não perguntar de novo");
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Desfazer registro" }));

    expect(onSkipFutureConfirmations).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["skip", "confirm"]);
  });

  it("does not call onSkipFutureConfirmations if checkbox is left unchecked", () => {
    const onSkipFutureConfirmations = vi.fn();
    const onConfirm = vi.fn();

    render(
      <VoidSettlementDialog
        open
        amountCents={5000}
        payerName="Alice"
        recipientName="Bob"
        busy={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        onSkipFutureConfirmations={onSkipFutureConfirmations}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Desfazer registro" }));

    expect(onSkipFutureConfirmations).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables both footer buttons and shows Desfazendo… while busy", () => {
    render(
      <VoidSettlementDialog
        open
        amountCents={3500}
        payerName="Alice"
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
