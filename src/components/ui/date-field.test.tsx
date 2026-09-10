import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { DateField } from "./date-field";

describe("DateField", () => {
  it("emits the picked day as an ISO string and displays it as dd/MM/yyyy", async () => {
    const handleChange = vi.fn();
    function Host() {
      const [value, setValue] = useState("2026-09-10");
      return (
        <DateField
          label="Data"
          value={value}
          onChange={(next) => {
            handleChange(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Host />);

    const trigger = screen.getByRole("button", { name: "Data" });
    expect(trigger).toHaveTextContent("10/09/2026");

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "15 de setembro de 2026" }));

    expect(handleChange).toHaveBeenCalledWith("2026-09-15");
    expect(screen.getByRole("button", { name: "Data" })).toHaveTextContent("15/09/2026");
  });

  it("blocks days outside min/max while keeping the boundary day selectable", async () => {
    const handleChange = vi.fn();
    render(
      <DateField
        label="Data"
        value="2026-09-15"
        onChange={handleChange}
        min="2026-09-10"
        max="2026-09-20"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Data" }));

    const before = await screen.findByRole("button", { name: "5 de setembro de 2026" });
    expect(before).toBeDisabled();
    fireEvent.click(before);
    expect(handleChange).not.toHaveBeenCalled();

    const after = screen.getByRole("button", { name: "25 de setembro de 2026" });
    expect(after).toBeDisabled();
    fireEvent.click(after);
    expect(handleChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "20 de setembro de 2026" }));
    expect(handleChange).toHaveBeenCalledWith("2026-09-20");
  });
});
