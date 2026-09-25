import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { haptics } from "@/hooks/use-haptics";
import { SplitEditor, type SplitPerson } from "./split-editor";
import { useSplitDraft, type SplitDraft } from "./use-split-draft";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

const PEOPLE: SplitPerson[] = [
  { id: "a", label: "Ana", name: "Ana", avatarUrl: null, isGuest: false },
  { id: "b", label: "Bia", name: "Bia", avatarUrl: null, isGuest: true },
  { id: "c", label: "Caio", name: "Caio", avatarUrl: null, isGuest: false },
];
const IDS = PEOPLE.map((person) => person.id);

interface Shares {
  percent: Record<string, number>;
  fixed: Record<string, number>;
  cents: Record<string, number>;
}

function renderEditor(totalCents: number, mode: SplitDraft["mode"]) {
  function Harness() {
    const split = useSplitDraft({
      peopleIds: IDS,
      totalCents,
      includeNewcomers: true,
      seed: () => ({ mode, included: IDS }),
    });
    const shares: Shares = { percent: split.draft.percent.shares, fixed: split.draft.fixed.shares, cents: split.centsById };
    return (
      <>
        <SplitEditor
          label="Quem consumiu"
          people={PEOPLE}
          mode={split.draft.mode}
          onModeChange={split.setMode}
          included={split.draft.included}
          onToggle={split.toggle}
          basisPointsById={split.draft.percent.shares}
          centsById={split.centsById}
          onShareChange={split.setShare}
          completable={split.completable}
          onComplete={split.complete}
          onSplitEvenly={split.canSplitEvenly ? split.splitEvenly : null}
          emptyText="Escolha quem consumiu."
          shareVerb="consumiu"
          remainderCents={split.remainderCents}
        />
        <output aria-label="Parcelas">{JSON.stringify(shares)}</output>
      </>
    );
  }
  render(<Harness />);
  const shares = (): Shares => JSON.parse(screen.getByLabelText("Parcelas").textContent ?? "{}");
  const sumOf = (values: Record<string, number>) => IDS.reduce((sum, id) => sum + (values[id] ?? 0), 0);
  return {
    shares,
    percentSum: () => sumOf(shares().percent),
    centsSum: () => sumOf(shares().cents),
  };
}

function slider(name: string) {
  return screen.getByRole("slider", { name: `Ajustar o percentual que ${name} consumiu` });
}

function percentBox(name: string) {
  return screen.getByRole("textbox", { name: `Percentual que ${name} consumiu` });
}

function drag(target: HTMLElement, percent: number) {
  fireEvent.pointerDown(target);
  fireEvent.change(target, { target: { value: String(percent) } });
  fireEvent.pointerUp(target);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SplitEditor percent sliders", () => {
  it("keeps the shares on exactly 100% and the centavos on the total while dragging", () => {
    const { shares, percentSum, centsSum } = renderEditor(6001, "percent");

    drag(slider("Ana"), 37);

    expect(shares().percent).toEqual({ a: 3700, b: 3150, c: 3150 });
    expect(percentSum()).toBe(10_000);
    expect(centsSum()).toBe(6001);
    expect(percentBox("Bia")).toHaveValue("31,50");

    drag(slider("Caio"), 12);
    expect(percentSum()).toBe(10_000);
    expect(centsSum()).toBe(6001);
  });

  it("sticks to a quarter when dragged next to it, but arrow keys still reach every percent", () => {
    const { shares } = renderEditor(10_000, "percent");

    drag(slider("Ana"), 49);
    expect(shares().percent.a).toBe(5000);
    expect(haptics.selectionChanged).toHaveBeenCalledOnce();

    fireEvent.change(slider("Ana"), { target: { value: "49" } });
    expect(shares().percent.a).toBe(4900);
  });
});

describe("SplitEditor completar", () => {
  it("hands one person exactly what the untouched people held", () => {
    const { shares, percentSum } = renderEditor(6000, "percent");
    expect(screen.queryByRole("button", { name: /^Completar/ })).not.toBeInTheDocument();

    fireEvent.change(percentBox("Ana"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Completar: Caio fica com o que falta (+15%)" }));

    expect(shares().percent).toEqual({ a: 7000, b: 0, c: 3000 });
    expect(shares().cents).toEqual({ a: 4200, b: 0, c: 1800 });
    expect(percentSum()).toBe(10_000);
    expect(screen.queryByRole("button", { name: /^Completar/ })).not.toBeInTheDocument();
  });

  it("completes typed amounts to the exact centavo", () => {
    const { shares, centsSum } = renderEditor(10_001, "fixed");

    fireEvent.change(screen.getByRole("textbox", { name: "Valor que Ana consumiu" }), { target: { value: "20,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Completar: Bia fica com o que falta (+40,00)" }));

    expect(shares().fixed).toEqual({ a: 2000, b: 8001, c: 0 });
    expect(centsSum()).toBe(10_001);
  });
});
