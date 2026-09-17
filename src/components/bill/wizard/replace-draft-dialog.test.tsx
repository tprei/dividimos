import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReplaceDraftDialog } from "./replace-draft-dialog";

describe("ReplaceDraftDialog", () => {
  it("renders draft title, item count, and formatted total for multiple items", () => {
    const totalCents = 7590;
    render(
      <ReplaceDraftDialog
        open={true}
        draftTitle="Almoço de Domingo"
        itemCount={5}
        totalCents={totalCents}
        onReplace={vi.fn()}
        onKeep={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Substituir a conta em rascunho?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/«Almoço de Domingo»/)).toBeInTheDocument();
    expect(screen.getByText(/5 itens/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*75,90/)).toBeInTheDocument();
  });

  it("pluralises singular item count correctly", () => {
    render(
      <ReplaceDraftDialog
        open={true}
        draftTitle="Café"
        itemCount={1}
        totalCents={1200}
        onReplace={vi.fn()}
        onKeep={vi.fn()}
      />,
    );

    expect(screen.getByText(/1 item/)).toBeInTheDocument();
    expect(screen.queryByText(/itens/)).not.toBeInTheDocument();
    expect(screen.getByText(/R\$\s*12,00/)).toBeInTheDocument();
  });

  it("omits item count for single-amount drafts with zero items", () => {
    render(
      <ReplaceDraftDialog
        open={true}
        draftTitle="Aluguel"
        itemCount={0}
        totalCents={150000}
        onReplace={vi.fn()}
        onKeep={vi.fn()}
      />,
    );

    expect(screen.getByText(/«Aluguel»/)).toBeInTheDocument();
    expect(screen.queryByText(/item/)).not.toBeInTheDocument();
    expect(screen.queryByText(/itens/)).not.toBeInTheDocument();
    expect(screen.getByText(/R\$\s*1\.500,00/)).toBeInTheDocument();
  });

  it("calls onKeep and never onReplace when clicking Manter rascunho", async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    const onKeep = vi.fn();

    render(
      <ReplaceDraftDialog
        open={true}
        draftTitle="Conta Antiga"
        itemCount={2}
        totalCents={3000}
        onReplace={onReplace}
        onKeep={onKeep}
      />,
    );

    const keepButton = screen.getByRole("button", { name: "Manter rascunho" });
    await user.click(keepButton);

    expect(onKeep).toHaveBeenCalledOnce();
    expect(onReplace).not.toHaveBeenCalled();
  });

  it("calls onReplace when clicking Substituir rascunho", async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    const onKeep = vi.fn();

    render(
      <ReplaceDraftDialog
        open={true}
        draftTitle="Conta Antiga"
        itemCount={2}
        totalCents={3000}
        onReplace={onReplace}
        onKeep={onKeep}
      />,
    );

    const replaceButton = screen.getByRole("button", { name: "Substituir rascunho" });
    await user.click(replaceButton);

    expect(onReplace).toHaveBeenCalledOnce();
    expect(onKeep).not.toHaveBeenCalled();
  });
});
