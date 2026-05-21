import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import {
  runBackHandlers,
  __resetBackHandlerStackForTests,
} from "@/lib/capacitor/back-handler";
import { Dialog } from "./dialog";

vi.mock("@base-ui/react/dialog", async () => {
  const actual = await vi.importActual<typeof import("@base-ui/react/dialog")>(
    "@base-ui/react/dialog",
  );
  return actual;
});

beforeEach(() => {
  __resetBackHandlerStackForTests();
  vi.clearAllMocks();
});

describe("Dialog back-handler integration", () => {
  it("fires onOpenChange(false) when runBackHandlers is called while open", () => {
    const onOpenChange = vi.fn();

    render(<Dialog open={true} onOpenChange={onOpenChange} />);

    act(() => {
      runBackHandlers();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false, expect.objectContaining({ reason: "escape-key" }));
  });

  it("does not fire onOpenChange when dialog is closed", () => {
    const onOpenChange = vi.fn();

    render(<Dialog open={false} onOpenChange={onOpenChange} />);

    act(() => {
      runBackHandlers();
    });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("unregisters handler when open flips from true to false", () => {
    const onOpenChange = vi.fn();

    const { rerender } = render(<Dialog open={true} onOpenChange={onOpenChange} />);
    rerender(<Dialog open={false} onOpenChange={onOpenChange} />);

    act(() => {
      runBackHandlers();
    });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("claims the event (runBackHandlers returns true) while open", () => {
    const onOpenChange = vi.fn();

    render(<Dialog open={true} onOpenChange={onOpenChange} />);

    let claimed: boolean;
    act(() => {
      claimed = runBackHandlers();
    });

    expect(claimed!).toBe(true);
  });

  it("does not fire onOpenChange on hardware back when dismissable=false", () => {
    const onOpenChange = vi.fn();

    render(<Dialog open={true} onOpenChange={onOpenChange} dismissable={false} />);

    act(() => {
      runBackHandlers();
    });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not claim the back event when dismissable=false (returns false)", () => {
    const onOpenChange = vi.fn();

    render(<Dialog open={true} onOpenChange={onOpenChange} dismissable={false} />);

    let claimed: boolean;
    act(() => {
      claimed = runBackHandlers();
    });

    expect(claimed!).toBe(false);
  });
});
