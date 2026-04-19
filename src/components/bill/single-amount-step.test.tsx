import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    selectionChanged: vi.fn(),
  },
}));

import { haptics } from "@/hooks/use-haptics";
import { SingleAmountStep } from "./single-amount-step";
import type { UserProfile } from "@/types";

const alice: UserProfile = { id: "u-alice", handle: "alice", name: "Alice" };
const bob: UserProfile = { id: "u-bob", handle: "bob", name: "Bob" };
const carol: UserProfile = { id: "u-carol", handle: "carol", name: "Carol" };

type FixedAssignment = { userId: string; amountCents: number };

function lastFixedCall(
  mock: ReturnType<typeof vi.fn>,
): FixedAssignment[] | undefined {
  return mock.mock.calls.at(-1)?.[0] as FixedAssignment[] | undefined;
}

function renderFixed(total = 15000) {
  const onSplitByFixed = vi.fn();
  const noop = vi.fn();
  const utils = render(
    <SingleAmountStep
      participants={[alice, bob, carol]}
      guests={[]}
      totalAmountInput={total}
      onSetTotal={noop}
      onSplitEqually={noop}
      onSplitByPercentage={noop}
      onSplitByFixed={onSplitByFixed}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Valor fixo/i }));
  return { ...utils, onSplitByFixed };
}

describe("SingleAmountStep fixed split", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders one slider per participant", () => {
    renderFixed();
    expect(screen.getAllByRole("slider")).toHaveLength(3);
    expect(screen.getByRole("slider", { name: /Alice/i })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /Bob/i })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /Carol/i })).toBeInTheDocument();
  });

  it("slider move emits onSplitByFixed with the participant's new amount", () => {
    const { onSplitByFixed } = renderFixed(15000);

    fireEvent.change(screen.getByRole("slider", { name: /Alice/i }), {
      target: { value: "4000" },
    });

    const assignments = lastFixedCall(onSplitByFixed);
    expect(assignments).toBeDefined();
    expect(assignments!.find((a) => a.userId === "u-alice")?.amountCents).toBe(4000);
    expect(assignments!.find((a) => a.userId === "u-bob")?.amountCents).toBe(0);
    expect(assignments!.find((a) => a.userId === "u-carol")?.amountCents).toBe(0);
  });

  it("setting one participant does not hide the others' sliders", () => {
    renderFixed(15000);

    fireEvent.change(screen.getByRole("slider", { name: /Alice/i }), {
      target: { value: "4000" },
    });

    expect(screen.getAllByRole("slider")).toHaveLength(3);
    expect(screen.getByRole("slider", { name: /Bob/i })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /Carol/i })).toBeInTheDocument();
  });

  it("'Igual' pill sets that participant to the equal share", () => {
    const { onSplitByFixed } = renderFixed(15000);

    const igualButtons = screen.getAllByRole("button", { name: /^Igual: /i });
    expect(igualButtons).toHaveLength(3);

    fireEvent.click(igualButtons[0]);

    const assignments = lastFixedCall(onSplitByFixed);
    expect(assignments!.find((a) => a.userId === "u-alice")?.amountCents).toBe(5000);
  });

  it("'Restante' pill completes the bill for a remaining participant", () => {
    const { onSplitByFixed } = renderFixed(15000);

    fireEvent.change(screen.getByRole("slider", { name: /Alice/i }), {
      target: { value: "4000" },
    });

    // With Alice at 4000 and Bob/Carol at 0, the remainder per row is 11000 —
    // neither Bob nor Carol should display the full-bill remainder on their row.
    const restanteButtons = screen.getAllByRole("button", { name: /^Restante: /i });
    expect(restanteButtons).toHaveLength(2);

    fireEvent.click(restanteButtons[0]);

    const assignments = lastFixedCall(onSplitByFixed);
    const filled = assignments!.filter(
      (a) => a.userId !== "u-alice" && a.amountCents > 0,
    );
    expect(filled).toHaveLength(1);
    expect(filled[0].amountCents).toBe(11000);
  });

  it("slider snaps magnetically to the equal-share point and fires a haptic tick", () => {
    renderFixed(15000);

    const aliceSlider = screen.getByRole("slider", { name: /Alice/i });
    // equalShare = 5000; drag to 5100 which is well within the snap radius.
    fireEvent.change(aliceSlider, { target: { value: "5100" } });

    expect(aliceSlider).toHaveValue("5000");
    expect(haptics.selectionChanged).toHaveBeenCalled();
  });
});
