import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WizardSteps } from "./wizard-steps";
import { WizardFooter } from "./wizard-footer";

describe("WizardSteps", () => {
  it("marks only the current step with aria-current", () => {
    render(<WizardSteps steps={["Participantes", "Valor e divisão", "Quem pagou"]} current={1} />);

    const items = screen.getAllByRole("listitem");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[2]).not.toHaveAttribute("aria-current");
  });

  it("renders every step label", () => {
    render(<WizardSteps steps={["Participantes", "Valor e divisão", "Quem pagou"]} current={0} />);

    expect(screen.getByText("Participantes")).toBeInTheDocument();
    expect(screen.getByText("Valor e divisão")).toBeInTheDocument();
    expect(screen.getByText("Quem pagou")).toBeInTheDocument();
  });
});

describe("WizardFooter", () => {
  it("reports the blocker and stays inert while disabled", async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(
      <WizardFooter
        onBack={null}
        onContinue={onContinue}
        continueLabel="Continuar"
        disabled
        reason="Adicione quem divide com você."
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Adicione quem divide com você.");
    const button = screen.getByRole("button", { name: "Continuar" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("goes back and continues when both actions exist", async () => {
    const onBack = vi.fn();
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(
      <WizardFooter onBack={onBack} onContinue={onContinue} continueLabel="Salvar conta" />,
    );

    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onBack).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Salvar conta" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("shows the saving state instead of the label", () => {
    render(
      <WizardFooter onBack={null} onContinue={vi.fn()} continueLabel="Salvar conta" loading />,
    );

    expect(screen.getByRole("button", { name: /Salvando/ })).toBeDisabled();
  });
});
