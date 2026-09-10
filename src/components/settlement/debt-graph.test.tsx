import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DebtGraph } from "./debt-graph";
import type { DebtEdge } from "@/lib/simplify";

const motionState = vi.hoisted(() => ({ reduced: false }));

vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => motionState.reduced,
}));

const participants = [
  { id: "a", name: "Ana Lima" },
  { id: "b", name: "Bruno Costa" },
  { id: "c", name: "Carla Souza" },
];

const edges: DebtEdge[] = [
  { fromUserId: "b", toUserId: "c", amountCents: 7000 },
  { fromUserId: "a", toUserId: "c", amountCents: 3000 },
];

const rawEdges: DebtEdge[] = [
  { fromUserId: "a", toUserId: "b", amountCents: 4000 },
  { fromUserId: "a", toUserId: "c", amountCents: 6000 },
  { fromUserId: "b", toUserId: "c", amountCents: 7000 },
];

function brl(cents: number): string {
  return `R$\u00a0${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function edgeLabel(edge: DebtEdge): string {
  const name = (id: string) => participants.find((p) => p.id === id)!.name;
  return `${name(edge.fromUserId)} paga ${brl(edge.amountCents)} para ${name(edge.toUserId)}`;
}

afterEach(() => {
  motionState.reduced = false;
  vi.useRealTimers();
  cleanup();
});

describe("DebtGraph", () => {
  it("renders the final arrangement immediately under reduced motion", () => {
    motionState.reduced = true;

    render(
      <DebtGraph participants={participants} edges={edges} rawEdges={rawEdges} />,
    );

    expect(screen.getByText("R$ 30,00")).toBeInTheDocument();
    expect(screen.queryByText("R$ 40,00")).not.toBeInTheDocument();
  });


  it("shows raw edges first and crossfades once to the final edges", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    render(
      <DebtGraph participants={participants} edges={edges} rawEdges={rawEdges} />,
    );

    expect(screen.getByText("R$ 40,00")).toBeInTheDocument();
    expect(screen.queryByText("R$ 30,00")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });


    expect(screen.getByText("R$ 30,00")).toBeInTheDocument();
  });

  it("selecting an edge calls onSelectEdge with the edge", () => {
    const onSelectEdge = vi.fn();

    render(
      <DebtGraph
        participants={participants}
        edges={edges}
        onSelectEdge={onSelectEdge}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: edgeLabel(edges[0]!) }));

    expect(onSelectEdge).toHaveBeenCalledWith({ from: "b", to: "c" });
  });

  it("selecting a node selects the first edge touching it", () => {
    const onSelectEdge = vi.fn();

    render(
      <DebtGraph
        participants={participants}
        edges={edges}
        onSelectEdge={onSelectEdge}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ana Lima" }));

    expect(onSelectEdge).toHaveBeenCalledWith({ from: "a", to: "c" });
  });

  it("clicking a selected edge again deselects it", () => {
    const onSelectEdge = vi.fn();

    render(
      <DebtGraph
        participants={participants}
        edges={edges}
        selected={{ from: "b", to: "c" }}
        onSelectEdge={onSelectEdge}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: edgeLabel(edges[0]!) }));

    expect(onSelectEdge).toHaveBeenCalledWith(null);
  });

  it("activates edges with the keyboard", () => {
    const onSelectEdge = vi.fn();

    render(
      <DebtGraph
        participants={participants}
        edges={edges}
        onSelectEdge={onSelectEdge}
      />,
    );

    fireEvent.keyDown(
      screen.getByRole("button", { name: edgeLabel(edges[1]!) }),
      { key: "Enter" },
    );

    expect(onSelectEdge).toHaveBeenCalledWith({ from: "a", to: "c" });
  });
});
