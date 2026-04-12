import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConversationQuickActions } from "./conversation-quick-actions";

describe("ConversationQuickActions", () => {
  const defaultProps = {
    onCharge: vi.fn(),
    onSplit: vi.fn(),
  };

  it("renders Cobrar and Dividir conta buttons", () => {
    render(<ConversationQuickActions {...defaultProps} />);

    expect(screen.getByText("Cobrar")).toBeInTheDocument();
    expect(screen.getByText("Dividir conta")).toBeInTheDocument();
  });

  it("renders buttons, not links", () => {
    render(<ConversationQuickActions {...defaultProps} />);

    const cobrar = screen.getByText("Cobrar");
    const dividir = screen.getByText("Dividir conta");

    expect(cobrar.tagName).toBe("BUTTON");
    expect(dividir.tagName).toBe("BUTTON");
    expect(cobrar.closest("a")).toBeNull();
    expect(dividir.closest("a")).toBeNull();
  });

  it("calls onCharge when Cobrar is clicked", async () => {
    const onCharge = vi.fn();
    render(<ConversationQuickActions onCharge={onCharge} onSplit={vi.fn()} />);

    await userEvent.click(screen.getByText("Cobrar"));

    expect(onCharge).toHaveBeenCalledOnce();
  });

  it("calls onSplit when Dividir conta is clicked", async () => {
    const onSplit = vi.fn();
    render(<ConversationQuickActions onCharge={vi.fn()} onSplit={onSplit} />);

    await userEvent.click(screen.getByText("Dividir conta"));

    expect(onSplit).toHaveBeenCalledOnce();
  });
});
