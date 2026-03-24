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

    expect(screen.getByText("Simplificar dividas")).toBeInTheDocument();
    expect(screen.getByText("Menos transferencias para todos")).toBeInTheDocument();
  });

  it("renders switch with correct aria label", () => {
    render(<SimplificationToggle {...defaultProps} />);

    // base-ui Switch renders as a button with role="switch"
    const toggle = screen.getByLabelText("Ativar simplificacao de dividas");
    expect(toggle).toBeInTheDocument();
  });

  it("shows counts and savings badge when enabled", () => {
    render(<SimplificationToggle {...defaultProps} enabled={true} />);

    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
    expect(screen.getByText("transacoes")).toBeInTheDocument();
  });

  it("shows 'Ver passo a passo' button when enabled", () => {
    render(<SimplificationToggle {...defaultProps} enabled={true} />);

    expect(screen.getByText("Ver passo a passo")).toBeInTheDocument();
  });

  it("calls onViewSteps when button clicked", async () => {
    const onViewSteps = vi.fn();
    const user = userEvent.setup();
    render(
      <SimplificationToggle {...defaultProps} enabled={true} onViewSteps={onViewSteps} />,
    );

    const btn = screen.getByText("Ver passo a passo").closest("button")!;
    await user.click(btn);
    expect(onViewSteps).toHaveBeenCalledOnce();
  });

  it("does not show detail panel when disabled", () => {
    render(<SimplificationToggle {...defaultProps} enabled={false} />);

    expect(screen.queryByText("transacoes")).not.toBeInTheDocument();
    expect(screen.queryByText("Ver passo a passo")).not.toBeInTheDocument();
  });
});
