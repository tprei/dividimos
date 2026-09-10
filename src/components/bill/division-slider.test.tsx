import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DivisionSlider } from "./division-slider";

function renderSlider(initial = 5000) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <DivisionSlider
        ariaLabel="Parcela"
        max={10000}
        min={0}
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  const slider = screen.getByRole("slider", { name: "Parcela" });
  return { onChange, slider };
}

describe("DivisionSlider", () => {
  it("forwards dragged values to the same onChange the numeric input drives", () => {
    const { onChange, slider } = renderSlider();
    fireEvent.change(slider, { target: { value: "4987" } });
    expect(onChange).toHaveBeenCalledWith(4987);
    expect(slider).toHaveValue("4987");
  });

  it("rounds fractional drag values to whole units", () => {
    const { onChange, slider } = renderSlider();
    fireEvent.change(slider, { target: { value: "4987.6" } });
    expect(onChange).toHaveBeenCalledWith(4988);
    expect(slider).toHaveValue("4988");
  });

  it("clamps dragged values to the range bounds", () => {
    const { onChange, slider } = renderSlider();
    fireEvent.change(slider, { target: { value: "99999" } });
    expect(onChange).toHaveBeenCalledWith(10000);
    expect(slider).toHaveValue("10000");
  });

  it("snaps to the nearest quarter of the range on release", () => {
    const { onChange, slider } = renderSlider();
    fireEvent.change(slider, { target: { value: "4900" } });
    fireEvent.pointerUp(slider);
    expect(onChange).toHaveBeenLastCalledWith(5000);
    expect(slider).toHaveValue("5000");
  });

  it("keeps intermediate values outside the snap threshold", () => {
    const { onChange, slider } = renderSlider();
    fireEvent.change(slider, { target: { value: "5300" } });
    fireEvent.pointerUp(slider);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(slider).toHaveValue("5300");
  });

  it("does not re-emit when released exactly on a snap point", () => {
    const { onChange, slider } = renderSlider(2500);
    fireEvent.pointerUp(slider);
    expect(onChange).not.toHaveBeenCalled();
  });
});
