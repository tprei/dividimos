import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DebtGraph } from "./debt-graph";
import type { DebtEdge } from "@/lib/simplify";

const originalMatchMedia = globalThis.matchMedia;

function enableReducedMotion(): void {
  globalThis.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof globalThis.matchMedia;
}

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

function edgeLabels(container: HTMLElement): number {
  return container.querySelectorAll('svg[role="group"] foreignObject').length;
}

function nodeCoordinates(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('svg[role="group"] circle'),
  ).map((circle) => `${circle.getAttribute("cx")},${circle.getAttribute("cy")}`);
}

afterEach(() => {
  globalThis.matchMedia = originalMatchMedia;
  vi.useRealTimers();
  cleanup();
});

describe("DebtGraph", () => {
  it("renders the final arrangement immediately under reduced motion", () => {
    enableReducedMotion();

    render(
      <DebtGraph participants={participants} edges={edges} rawEdges={rawEdges} />,
    );

    expect(screen.getByText("R$ 30,00")).toBeInTheDocument();
    expect(screen.queryByText("R$ 40,00")).not.toBeInTheDocument();
  });

  it("keeps the raw/simplified toggle working without transitions under reduced motion", () => {
    enableReducedMotion();

    const { container } = render(
      <DebtGraph participants={participants} edges={edges} rawEdges={rawEdges} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Ver dívidas originais" }),
    );
    expect(screen.getByText("R$ 40,00")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Ver plano simplificado" }),
    );
    expect(screen.queryByText("R$ 40,00")).not.toBeInTheDocument();
    expect(screen.getByText("R$ 30,00")).toBeInTheDocument();
    expect(edgeLabels(container)).toBe(2);
  });

  it("shows every raw edge first, then settles on exactly the simplified transfers", async () => {
    enableReducedMotion();

    const { container } = render(
      <DebtGraph participants={participants} edges={edges} rawEdges={rawEdges} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ver dívidas originais" }));
    expect(screen.getByText("R$ 40,00")).toBeInTheDocument();
    expect(screen.getByText("R$ 70,00")).toBeInTheDocument();
    expect(await screen.findByText("R$ 60,00")).toBeInTheDocument();
    expect(edgeLabels(container)).toBe(rawEdges.length);

    fireEvent.click(screen.getByRole("button", { name: "Ver plano simplificado" }));
    expect(screen.queryByText("R$ 40,00")).not.toBeInTheDocument();
    expect(await screen.findByText("R$ 30,00")).toBeInTheDocument();
    expect(edgeLabels(container)).toBe(edges.length);
  });

  it("keeps node positions stable across the raw and simplified phases", () => {
    enableReducedMotion();

    const { container } = render(
      <DebtGraph participants={participants} edges={edges} rawEdges={rawEdges} />,
    );
    const simplifiedPositions = nodeCoordinates(container);
    expect(simplifiedPositions).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Ver dívidas originais" }));
    expect(nodeCoordinates(container)).toEqual(simplifiedPositions);

    fireEvent.click(screen.getByRole("button", { name: "Ver plano simplificado" }));
    expect(nodeCoordinates(container)).toEqual(simplifiedPositions);
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
