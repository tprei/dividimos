import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { toIsoDate } from "@/lib/date-shortcuts";
import { DateField } from "./date-field";

function isoShift(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00`);
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

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

  it("keeps six week rows and selectable adjacent-month days even in a four-week month", async () => {
    const handleChange = vi.fn();
    render(<DateField label="Data" value="2026-02-15" onChange={handleChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Data" }));

    // One weekday header row plus exactly six week rows, whatever the month.
    const rows = await screen.findAllByRole("row");
    expect(rows).toHaveLength(7);

    const trailing = screen.getByRole("button", { name: "1 de março de 2026" });
    expect(trailing).toBeEnabled();
    fireEvent.click(trailing);
    expect(handleChange).toHaveBeenCalledWith("2026-03-01");
  });

  it("picks a shortcut chip, which also closes the dialog", async () => {
    const handleChange = vi.fn();
    const today = toIsoDate(new Date());
    render(<DateField label="Data" value={today} onChange={handleChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ontem" }));

    expect(handleChange).toHaveBeenCalledWith(isoShift(today, -1));
    expect(screen.queryByRole("button", { name: "Ontem" })).not.toBeInTheDocument();
  });

  it("never offers a shortcut the max date forbids", async () => {
    const today = toIsoDate(new Date());
    render(
      <DateField label="Data" value={today} onChange={vi.fn()} max={isoShift(today, -1)} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Data" }));

    expect(await screen.findByRole("button", { name: "Ontem" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Hoje" })).not.toBeInTheDocument();
  });

  it("moves keyboard focus with the arrow keys across month borders", async () => {
    const today = toIsoDate(new Date());
    render(<DateField label="Data" value={today} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Data" }));

    await screen.findByRole("grid");
    const activeButton = document.activeElement as HTMLButtonElement;
    expect(activeButton.dataset.iso).toBe(today);

    fireEvent.keyDown(activeButton, { key: "ArrowRight" });
    expect((document.activeElement as HTMLButtonElement).dataset.iso).toBe(isoShift(today, 1));

    fireEvent.keyDown(document.activeElement as HTMLButtonElement, { key: "ArrowLeft" });
    expect((document.activeElement as HTMLButtonElement).dataset.iso).toBe(today);
  });

  it("keeps the shown month when arrows land on a neighbour day the grid already displays", async () => {
    const handleChange = vi.fn();
    render(<DateField label="Data" value="2026-02-15" onChange={handleChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Data" }));

    await screen.findByRole("grid");
    expect((document.activeElement as HTMLButtonElement).dataset.iso).toBe("2026-02-15");

    // February 2026 starts on a Sunday, so its six rows cover Feb 1 to Mar 14.
    const down = { key: "ArrowDown" };
    fireEvent.keyDown(document.activeElement as HTMLButtonElement, down);
    fireEvent.keyDown(document.activeElement as HTMLButtonElement, down);
    fireEvent.keyDown(document.activeElement as HTMLButtonElement, down);
    expect((document.activeElement as HTMLButtonElement).dataset.iso).toBe("2026-03-08");
    expect(screen.getByText("fevereiro de 2026")).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement as HTMLButtonElement, down);
    expect((document.activeElement as HTMLButtonElement).dataset.iso).toBe("2026-03-15");
    expect(screen.getByText("março de 2026")).toBeInTheDocument();
  });
});
