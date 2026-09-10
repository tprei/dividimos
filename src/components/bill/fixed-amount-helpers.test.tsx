import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FixedAmountHelpers } from "./fixed-amount-helpers";

describe("FixedAmountHelpers", () => {
  it("derives chips bounded by a small total", () => {
    render(
      <FixedAmountHelpers
        totalCents={500}
        remainingCents={500}
        onAdd={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Adicionar R$\u00a01,00" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Adicionar R$\u00a02,00" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Adicionar R$\u00a05,00" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Completar R$\u00a05,00" }),
    ).toBeInTheDocument();
  });

  it("scales chips with a large total and hides the fill chip once spent", () => {
    render(
      <FixedAmountHelpers
        totalCents={24000}
        remainingCents={0}
        onAdd={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Adicionar R$\u00a020,00" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Adicionar R$\u00a050,00" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Adicionar R$\u00a0100,00" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Adicionar R$\u00a01,00" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("fixed-amount-fill")).not.toBeInTheDocument();
  });

  it("emits exactly the remaining cents from the fill chip", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <FixedAmountHelpers
        totalCents={24000}
        remainingCents={7300}
        onAdd={onAdd}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Completar R$\u00a073,00" }),
    );
    expect(onAdd).toHaveBeenCalledWith(7300);
  });

  it("skips the fill chip when a base chip already matches the remainder", () => {
    const onAdd = vi.fn();
    render(
      <FixedAmountHelpers
        totalCents={24000}
        remainingCents={5000}
        onAdd={onAdd}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Completar R$\u00a050,00" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Adicionar R$\u00a050,00" }),
    ).toBeEnabled();
  });

  it("disables overshooting chips and leaves the fill chip enabled", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <FixedAmountHelpers
        totalCents={24000}
        remainingCents={300}
        onAdd={onAdd}
      />,
    );
    const overshoot = screen.getByRole("button", {
      name: "Adicionar R$\u00a020,00",
    });
    expect(overshoot).toBeDisabled();
    const fill = screen.getByRole("button", {
      name: "Completar R$\u00a03,00",
    });
    expect(fill).toBeEnabled();
    await user.click(overshoot);
    expect(onAdd).not.toHaveBeenCalled();
    await user.click(fill);
    expect(onAdd).toHaveBeenCalledWith(300);
  });
});
