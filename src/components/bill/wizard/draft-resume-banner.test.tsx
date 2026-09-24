import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DraftResumeBanner } from "./draft-resume-banner";

describe("DraftResumeBanner", () => {

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

});
