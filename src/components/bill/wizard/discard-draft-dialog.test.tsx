import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DiscardDraftDialog } from "./discard-draft-dialog";

describe("DiscardDraftDialog", () => {

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

  it("keeps the draft when Escape dismisses the confirmation", async () => {
    const user = userEvent.setup();
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    render(<DiscardDraftDialog open draftTitle="Pizza" itemCount={0} totalCents={8000} mode="banner-discard" onDiscard={onDiscard} onKeep={onKeep} />);
    await user.keyboard("{Escape}");
    expect(onKeep).toHaveBeenCalledOnce();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
