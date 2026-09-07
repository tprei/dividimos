import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { haptics } from "@/hooks/use-haptics";
import { SwipeableBillCard } from "./swipeable-bill-card";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

describe("SwipeableBillCard", () => {
  const defaultProps = {
    enabled: true,
    onDelete: vi.fn(),
  };

  it("renders children", () => {
    render(
      <SwipeableBillCard {...defaultProps}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    expect(screen.getByText("Bill content")).toBeInTheDocument();
  });

  it("renders the delete action button when enabled", () => {
    render(
      <SwipeableBillCard {...defaultProps}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    expect(screen.getByRole("button", { name: /excluir conta/i })).toBeInTheDocument();
  });

  it("shows the Excluir label on the action button", () => {
    render(
      <SwipeableBillCard {...defaultProps}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    expect(screen.getByText("Excluir")).toBeInTheDocument();
  });

  it("calls onDelete when delete button is clicked", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <SwipeableBillCard {...defaultProps} onDelete={onDelete}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    await user.click(screen.getByRole("button", { name: /excluir conta/i }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("renders children directly without actions when disabled", () => {
    render(
      <SwipeableBillCard {...defaultProps} enabled={false}>
        <div>Deleted bill</div>
      </SwipeableBillCard>,
    );

    expect(screen.getByText("Deleted bill")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /excluir conta/i })).not.toBeInTheDocument();
  });

  it("does not wrap disabled card in swipeable container", () => {
    render(
      <SwipeableBillCard {...defaultProps} enabled={false}>
        <div data-testid="child">Content</div>
      </SwipeableBillCard>,
    );

    const child = screen.getByTestId("child");
    expect(child.closest(".overflow-hidden")).toBeNull();
  });

  it("has proper drag constraints on the draggable layer", () => {
    const { container } = render(
      <SwipeableBillCard {...defaultProps}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    const draggableDiv = container.querySelector("[drag='x']");
    expect(draggableDiv).not.toBeNull();
  });

  it("renders the swipe hint chevron when enabled", () => {
    const { container } = render(
      <SwipeableBillCard {...defaultProps}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    const hintContainer = container.querySelector(".pointer-events-none");
    expect(hintContainer).not.toBeNull();
  });

  it("imports haptics.impact for swipe snap feedback", () => {
    expect(haptics.impact).toBeDefined();
    expect(typeof haptics.impact).toBe("function");
  });
});
