import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppleSignInButton } from "./apple-sign-in-button";

describe("AppleSignInButton", () => {
  it("forwards its button ref and invokes the callback", () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(<AppleSignInButton ref={ref} onClick={onClick} pending={false} disabled={false} />);
    const button = screen.getByRole("button", { name: "Continuar com a Apple" });
    expect(ref.current).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("prevents repeat submissions while pending even when disabled is false", () => {
    const onClick = vi.fn();
    render(<AppleSignInButton onClick={onClick} pending disabled={false} />);
    const button = screen.getByRole("button", { name: "Entrando com a Apple" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disables entry when another provider is pending without announcing Apple as busy", () => {
    render(<AppleSignInButton onClick={vi.fn()} pending={false} disabled />);
    const button = screen.getByRole("button", { name: "Continuar com a Apple" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
  });
});
