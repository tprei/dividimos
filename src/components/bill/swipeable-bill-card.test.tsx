import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SwipeableBillCard } from "./swipeable-bill-card";

describe("SwipeableBillCard", () => {
  const defaultProps = {
    enabled: true,
    onEdit: vi.fn(),
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

  it("renders edit and delete action buttons when enabled", () => {
    render(
      <SwipeableBillCard {...defaultProps}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    expect(screen.getByRole("button", { name: /editar rascunho/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /excluir rascunho/i })).toBeInTheDocument();
  });

  it("shows Editar and Excluir labels on action buttons", () => {
    render(
      <SwipeableBillCard {...defaultProps}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    expect(screen.getByText("Editar")).toBeInTheDocument();
    expect(screen.getByText("Excluir")).toBeInTheDocument();
  });

  it("calls onEdit when edit button is clicked", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();

    render(
      <SwipeableBillCard {...defaultProps} onEdit={onEdit}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    await user.click(screen.getByRole("button", { name: /editar rascunho/i }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("calls onDelete when delete button is clicked", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <SwipeableBillCard {...defaultProps} onDelete={onDelete}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    await user.click(screen.getByRole("button", { name: /excluir rascunho/i }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("renders children directly without actions when disabled", () => {
    render(
      <SwipeableBillCard {...defaultProps} enabled={false}>
        <div>Non-draft bill</div>
      </SwipeableBillCard>,
    );

    expect(screen.getByText("Non-draft bill")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /editar rascunho/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /excluir rascunho/i })).not.toBeInTheDocument();
  });

  it("does not wrap disabled card in swipeable container", () => {
    const { container } = render(
      <SwipeableBillCard {...defaultProps} enabled={false}>
        <div data-testid="child">Content</div>
      </SwipeableBillCard>,
    );

    // When disabled, the child should not be inside the overflow-hidden wrapper
    const child = screen.getByTestId("child");
    expect(child.closest(".overflow-hidden")).toBeNull();
  });

  it("has proper drag constraints on the draggable layer", () => {
    const { container } = render(
      <SwipeableBillCard {...defaultProps}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    // The motion.div mock passes through non-motion props like drag
    const draggableDiv = container.querySelector("[drag='x']");
    expect(draggableDiv).not.toBeNull();
  });

  it("renders the swipe hint chevron when enabled", () => {
    const { container } = render(
      <SwipeableBillCard {...defaultProps}>
        <div>Bill content</div>
      </SwipeableBillCard>,
    );

    // The chevron hint is inside a pointer-events-none div
    const hintContainer = container.querySelector(".pointer-events-none");
    expect(hintContainer).not.toBeNull();
  });
});
