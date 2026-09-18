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
    expect(
      screen.getByRole("heading", {
        name: "Continuar de onde você parou?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("«Mercado Semanal» · ainda não está no grupo"),
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

  it("describes an unnamed draft with 1 item", () => {
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
      screen.getByText("1 item · ainda não está no grupo"),
    ).toBeInTheDocument();
  });

  it("describes an unnamed draft with multiple items", () => {
    render(
      <DraftResumeBanner
        title={null}
        itemCount={3}
        totalCents={4500}
        onContinue={vi.fn()}
        onDiscardRequest={vi.fn()}
      />,
    );

    expect(
      screen.getByText("3 itens · ainda não está no grupo"),
    ).toBeInTheDocument();
  });

  it("describes an unnamed empty draft", () => {
    render(
      <DraftResumeBanner
        title={null}
        itemCount={0}
        totalCents={0}
        onContinue={vi.fn()}
        onDiscardRequest={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Ainda não está no grupo"),
    ).toBeInTheDocument();
  });
});
