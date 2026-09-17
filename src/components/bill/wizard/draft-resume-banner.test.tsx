import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DraftResumeBanner } from "./draft-resume-banner";

describe("DraftResumeBanner", () => {
  it("renders status banner with title, description, and formatted Money total", () => {
    const totalCents = 12550;
    render(
      <DraftResumeBanner
        title="Mercado Semanal"
        itemCount={3}
        totalCents={totalCents}
        onContinue={vi.fn()}
        onDiscardRequest={vi.fn()}
      />,
    );

    const banner = screen.getByRole("status");
    expect(banner).toBeInTheDocument();
    expect(screen.getByText("RASCUNHO PENDENTE")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Continuar de onde você parou: «Mercado Semanal»",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Rascunho salvo neste navegador — ainda não é uma conta no grupo."),
    ).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*125,50/)).toBeInTheDocument();
  });

  it("calls onContinue when clicking Continuar", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onDiscardRequest = vi.fn();

    render(
      <DraftResumeBanner
        title="Jantar"
        itemCount={1}
        totalCents={5000}
        onContinue={onContinue}
        onDiscardRequest={onDiscardRequest}
      />,
    );

    const continueBtn = screen.getByRole("button", { name: "Continuar" });
    await user.click(continueBtn);

    expect(onContinue).toHaveBeenCalledOnce();
    expect(onDiscardRequest).not.toHaveBeenCalled();
  });

  it("calls onDiscardRequest when clicking Descartar", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onDiscardRequest = vi.fn();

    render(
      <DraftResumeBanner
        title="Almoço"
        itemCount={2}
        totalCents={3000}
        onContinue={onContinue}
        onDiscardRequest={onDiscardRequest}
      />,
    );

    const discardBtn = screen.getByRole("button", { name: "Descartar" });
    await user.click(discardBtn);

    expect(onDiscardRequest).toHaveBeenCalledOnce();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("describes an unnamed itemized draft by its contents instead of the default title", () => {
    render(
      <DraftResumeBanner
        title={null}
        itemCount={1}
        totalCents={2200}
        onContinue={vi.fn()}
        onDiscardRequest={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Continuar de onde você parou: 1 item" }),
    ).toBeInTheDocument();
  });
});
