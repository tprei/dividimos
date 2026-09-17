import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatBRL } from "@/lib/currency";
import { ReplaceDraftDialog } from "./replace-draft-dialog";

describe("ReplaceDraftDialog", () => {
  it("renders draft title, item count, and formatted total", () => {
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
    expect(
      screen.getByText((_, element) => element?.textContent === formatBRL(totalCents)),
    ).toBeInTheDocument();
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
