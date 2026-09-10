import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { haptics } from "@/hooks/use-haptics";
import { DivisionSlider, type DivisionSliderProps } from "./division-slider";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

function renderSlider(initial = 5000, props: Partial<DivisionSliderProps> = {}) {
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
        {...props}
      />
    );
  }
  render(<Harness />);
  const slider = screen.getByRole("slider", { name: "Parcela" });
  return { onChange, slider };
}

describe("DivisionSlider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    expect(haptics.tap).not.toHaveBeenCalled();
  });

  it("keeps stepped drags on whole units", () => {
    const { onChange, slider } = renderSlider(45, {
      max: 100,
      step: 1,
      snap: { step: 5, threshold: 2 },
    });
    fireEvent.change(slider, { target: { value: "47.6" } });
    expect(onChange).toHaveBeenCalledWith(48);
    expect(slider).toHaveValue("48");
  });

  it("snaps a stepped release within the threshold to the exact multiple of the step", () => {
    const { onChange, slider } = renderSlider(48, {
      max: 100,
      step: 1,
      snap: { step: 5, threshold: 2 },
    });
    fireEvent.pointerUp(slider);
    expect(onChange).toHaveBeenLastCalledWith(50);
    expect(slider).toHaveValue("50");
    expect(haptics.tap).toHaveBeenCalledOnce();
  });

  it("does not fire haptics for drags that do not snap", () => {
    const { onChange, slider } = renderSlider();
    fireEvent.change(slider, { target: { value: "5300" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(haptics.tap).not.toHaveBeenCalled();
  });
});
