import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConversationQuickActions } from "./conversation-quick-actions";

describe("ConversationQuickActions", () => {
  it("passes the pressed control to onCharge so the form can anchor to it", async () => {
    const onCharge = vi.fn();
    render(<ConversationQuickActions onCharge={onCharge} onSplit={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Nova cobrança" });
    await userEvent.click(button);

    expect(onCharge).toHaveBeenCalledWith(button);
  });

  it("calls onSplit when Dividir conta is pressed", async () => {
    const onSplit = vi.fn();
    render(<ConversationQuickActions onCharge={vi.fn()} onSplit={onSplit} />);

    await userEvent.click(screen.getByRole("button", { name: "Dividir conta" }));

    expect(onSplit).toHaveBeenCalledOnce();
  });
});
