import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SimplificationResult } from "@/lib/simplify";
import type { User } from "@/types";
import { SimplificationViewer } from "./simplification-viewer";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: { selectionChanged: vi.fn(), impact: vi.fn(), success: vi.fn() },
}));

const alice: User = {
  id: "user-alice",
  email: "alice@example.com",
  handle: "alice",
  name: "Alice Silva",
  pixKeyType: "email",
  pixKeyHint: "",
  onboarded: true,
  createdAt: "",
};

const bruno: User = { ...alice, id: "user-bruno", handle: "bruno", name: "Bruno Souza" };
const carla: User = { ...alice, id: "user-carla", handle: "carla", name: "Carla Dias" };

const participants = [alice, bruno, carla];

function edge(from: string, to: string, amountCents: number) {
  return { fromUserId: from, toUserId: to, amountCents };
}

function resultWithSteps(count: number): SimplificationResult {
  const edges = [edge(bruno.id, alice.id, 5000)];
  return {
    originalEdges: edges,
    steps: Array.from({ length: count }, (_, index) => ({
      edges,
      description: `Passo ${index + 1}`,
    })),
    simplifiedEdges: edges,
    originalCount: 1,
    simplifiedCount: 1,
  };
}

describe("SimplificationViewer", () => {
  it("keeps rendering when a new result has fewer steps than the one being viewed", () => {
    const { rerender } = render(
      <SimplificationViewer result={resultWithSteps(4)} participants={participants} />,
    );

    // Walk to the last step of the long result.
    fireEvent.click(screen.getByRole("button", { name: "Ir para passo 4" }));
    expect(screen.getByText("Passo 4 de 4")).toBeInTheDocument();

    // A recomputed ledger yields a shorter walkthrough.
    rerender(<SimplificationViewer result={resultWithSteps(2)} participants={participants} />);

    expect(screen.getByText("Passo 2 de 2")).toBeInTheDocument();
  });

  it("renders nothing for a result with no steps", () => {
    const { container } = render(
      <SimplificationViewer result={resultWithSteps(0)} participants={participants} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
