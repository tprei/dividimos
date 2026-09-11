import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PercentHelpers } from "./percent-helpers";

describe("PercentHelpers", () => {
  it("renders the chips plus a fill chip for an odd remainder", () => {
    render(<PercentHelpers remainingBasisPoints={1250} onAdd={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Adicionar 5%" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar 10%" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar 25%" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Completar 12,5%" })).toBeInTheDocument();
  });

  it("emits exactly the remaining basis points from the fill chip", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<PercentHelpers remainingBasisPoints={1250} onAdd={onAdd} />);
    await user.click(screen.getByRole("button", { name: "Completar 12,5%" }));
    expect(onAdd).toHaveBeenCalledWith(1250);
  });

  it("skips the fill chip when a base chip already matches the remainder", () => {
    render(<PercentHelpers remainingBasisPoints={500} onAdd={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Completar 5%" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar 5%" })).toBeEnabled();
  });

  it("disables every chip and hides the fill chip once the split is complete", () => {
    render(<PercentHelpers remainingBasisPoints={0} onAdd={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Adicionar 5%" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Adicionar 10%" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Adicionar 25%" })).toBeDisabled();
    expect(screen.queryByTestId("percent-helpers-fill")).not.toBeInTheDocument();
  });

  it("never lets a chip push past the remaining basis points", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<PercentHelpers remainingBasisPoints={700} onAdd={onAdd} />);
    const overshoot = screen.getByRole("button", { name: "Adicionar 10%" });
    expect(overshoot).toBeDisabled();
    await user.click(overshoot);
    expect(onAdd).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Adicionar 5%" }));
    expect(onAdd).toHaveBeenCalledWith(500);
  });
});
