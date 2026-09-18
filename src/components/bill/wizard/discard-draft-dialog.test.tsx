import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DiscardDraftDialog } from "./discard-draft-dialog";

describe("DiscardDraftDialog", () => {
  it("renders type-switch dialog with itemized body when itemCount > 0", () => {
    const totalCents = 8450;
    render(
      <DiscardDraftDialog
        open={true}
        draftTitle="Churrasco"
        itemCount={4}
        totalCents={totalCents}
        mode="type-switch"
        onDiscard={vi.fn()}
        onKeep={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Descartar a conta «Churrasco» em rascunho?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Trocar o tipo de conta apaga 4 itens.*84,50.*do rascunho/),
    ).toBeInTheDocument();
  });

  it("renders type-switch dialog with single_amount body when itemCount is 0", () => {
    const totalCents = 15000;
    render(
      <DiscardDraftDialog
        open={true}
        draftTitle="Conta de Luz"
        itemCount={0}
        totalCents={totalCents}
        mode="type-switch"
        onDiscard={vi.fn()}
        onKeep={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Descartar a conta «Conta de Luz» em rascunho?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Trocar o tipo de conta apaga o valor de.*150,00.*quem divide do rascunho/),
    ).toBeInTheDocument();
  });

  it("renders voice mode title and body", () => {
    const totalCents = 6200;
    render(
      <DiscardDraftDialog
        open={true}
        draftTitle="Pizza"
        itemCount={3}
        totalCents={totalCents}
        mode="voice"
        onDiscard={vi.fn()}
        onKeep={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Substituir a conta em rascunho?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Gravar por voz vai substituir «Pizza» \(3 itens,.*62,00\)/),
    ).toBeInTheDocument();
  });

  it("renders banner-discard mode", () => {
    render(
      <DiscardDraftDialog
        open={true}
        draftTitle="Supermercado"
        itemCount={2}
        totalCents={4500}
        mode="banner-discard"
        onDiscard={vi.fn()}
        onKeep={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Descartar o rascunho?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Se descartar, você perde o que já preencheu \(2 itens,.*45,00\)\. Não dá pra desfazer\./),
    ).toBeInTheDocument();
  });

  it("drops the item clause for a single-amount draft and pluralises one item", () => {
    render(
      <DiscardDraftDialog
        open={true}
        draftTitle="Aluguel"
        itemCount={0}
        totalCents={150000}
        mode="banner-discard"
        isItemized={false}
        onDiscard={vi.fn()}
        onKeep={vi.fn()}
      />,
    );

    expect(screen.getByText(/perde o que já preencheu \(R\$.*1\.500,00\)\. Não dá pra desfazer\./)).toBeInTheDocument();
  });

  it("calls onKeep when clicking Manter rascunho", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const onKeep = vi.fn();

    render(
      <DiscardDraftDialog
        open={true}
        draftTitle="Rascunho"
        itemCount={1}
        totalCents={2000}
        mode="type-switch"
        onDiscard={onDiscard}
        onKeep={onKeep}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Manter rascunho" }));
    expect(onKeep).toHaveBeenCalledOnce();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("calls onDiscard when clicking Descartar rascunho", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const onKeep = vi.fn();

    render(
      <DiscardDraftDialog
        open={true}
        draftTitle="Rascunho"
        itemCount={1}
        totalCents={2000}
        mode="type-switch"
        onDiscard={onDiscard}
        onKeep={onKeep}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Descartar rascunho" }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onKeep).not.toHaveBeenCalled();
  });
});
