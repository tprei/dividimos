import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SimplificationToggle } from "./simplification-toggle";

describe("SimplificationToggle", () => {
  const defaultProps = {
    originalCount: 5,
    simplifiedCount: 2,
    enabled: false,
    onToggle: vi.fn(),
    onViewSteps: vi.fn(),
  };

  it("renders toggle label", () => {
    render(<SimplificationToggle {...defaultProps} />);

    expect(screen.getByText("Simplificar dívidas")).toBeInTheDocument();
    expect(screen.getByText("Menos Pix pra todo mundo")).toBeInTheDocument();
  });

  it("renders switch with correct aria label", () => {
    render(<SimplificationToggle {...defaultProps} />);

    // base-ui Switch renders as a button with role="switch"
    const toggle = screen.getByLabelText("Ativar simplificação de dívidas");
    expect(toggle).toBeInTheDocument();
  });

  it("shows counts and savings badge when enabled", () => {
    render(<SimplificationToggle {...defaultProps} enabled={true} />);

    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
    expect(screen.getByText("Pix")).toBeInTheDocument();
  });

  it("shows 'Ver como simplificou' button when enabled", () => {
    render(<SimplificationToggle {...defaultProps} enabled={true} />);

    expect(screen.getByText("Ver como simplificou")).toBeInTheDocument();
  });

  it("calls onViewSteps when button clicked", async () => {
    const onViewSteps = vi.fn();
    const user = userEvent.setup();
    render(
      <SimplificationToggle {...defaultProps} enabled={true} onViewSteps={onViewSteps} />,
    );

    const btn = screen.getByText("Ver como simplificou").closest("button")!;
    await user.click(btn);
    expect(onViewSteps).toHaveBeenCalledOnce();
  });

  it("does not show detail panel when disabled", () => {
    render(<SimplificationToggle {...defaultProps} enabled={false} />);

    expect(screen.queryByText("Pix")).not.toBeInTheDocument();
    expect(screen.queryByText("Ver como simplificou")).not.toBeInTheDocument();
  });
});
