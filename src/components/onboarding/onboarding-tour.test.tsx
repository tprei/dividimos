import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { OnboardingTour } from "./onboarding-tour";

// Real hook — no mock. Visibility is driven through localStorage so the
// boundary behaviour exercised here is the actual production path.

function setupTourTargets() {
  const targets = [
    { attr: "balance-card", text: "Balance" },
    { attr: "quick-actions", text: "Actions" },
    { attr: "debt-tabs", text: "Tabs" },
    { attr: "nav-bar", text: "Nav" },
  ];
  const elements: HTMLDivElement[] = [];
  for (const t of targets) {
    const el = document.createElement("div");
    el.setAttribute("data-tour", t.attr);
    el.textContent = t.text;
    el.style.position = "absolute";
    el.style.top = "100px";
    el.style.left = "50px";
    el.style.width = "200px";
    el.style.height = "60px";
    document.body.appendChild(el);
    elements.push(el);
  }
  return elements;
}

describe("OnboardingTour", () => {
  let tourElements: HTMLDivElement[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    tourElements = setupTourTargets();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const el of tourElements) {
      el.remove();
    }
    tourElements = [];
  });

  async function settleRecalc() {
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
  }

  // ---- Basic rendering ----

  it("does not render when userId is null", () => {
    render(<OnboardingTour userId={null} identityGeneration={1} />);
    expect(screen.queryByText("Seu saldo")).not.toBeInTheDocument();
  });

  it("does not render when already completed", () => {
    localStorage.setItem("dividimos_tour_completed_A", "true");
    render(<OnboardingTour userId="A" identityGeneration={1} />);
    expect(screen.queryByText("Seu saldo")).not.toBeInTheDocument();
  });

  it("renders first step for an authenticated user", async () => {
    render(<OnboardingTour userId="A" identityGeneration={1} />);
    await settleRecalc();
    expect(screen.getByText("Seu saldo")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Aqui você vê quanto deve ou tem a receber. Toque no olho para esconder o valor.",
      ),
    ).toBeInTheDocument();
  });

  it("advances to next step on Próximo click", async () => {
    render(<OnboardingTour userId="A" identityGeneration={1} />);
    await settleRecalc();
    fireEvent.click(screen.getByText("Próximo"));
    await settleRecalc();
    expect(screen.getByText("Ações rápidas")).toBeInTheDocument();
  });

  // ---- Identity-boundary isolation ----

  it("hides the portal immediately on A→null then shows B at step 0", async () => {
    const { rerender } = render(<OnboardingTour userId="A" identityGeneration={1} />);
    await settleRecalc();
    expect(screen.getByText("Seu saldo")).toBeInTheDocument();

    // Advance to a mid-step.
    fireEvent.click(screen.getByText("Próximo"));
    await settleRecalc();
    expect(screen.getByText("Ações rápidas")).toBeInTheDocument();

    // A → null: the portal disappears before any timer fires.
    rerender(<OnboardingTour userId={null} identityGeneration={2} />);
    expect(screen.queryByText("Ações rápidas")).not.toBeInTheDocument();
    expect(screen.queryByText("Seu saldo")).not.toBeInTheDocument();

    // null → B: B starts at step 0 after its own recalc.
    rerender(<OnboardingTour userId="B" identityGeneration={3} />);
    await settleRecalc();
    expect(screen.getByText("Seu saldo")).toBeInTheDocument();
    expect(screen.queryByText("Ações rápidas")).not.toBeInTheDocument();
  });

  it("gen bump during celebration does not write a completion key", async () => {
    const { rerender } = render(<OnboardingTour userId="A" identityGeneration={1} />);

    // Walk to the last step.
    for (let i = 0; i < 3; i++) {
      await settleRecalc();
      fireEvent.click(screen.getByText("Próximo"));
    }
    await settleRecalc();
    expect(screen.getByText("Concluir")).toBeInTheDocument();

    // Enter celebration.
    fireEvent.click(screen.getByText("Concluir"));
    expect(screen.getByText("Pronto!")).toBeInTheDocument();

    // Gen bump before the 2 s celebration timer fires.
    rerender(<OnboardingTour userId="A" identityGeneration={2} />);

    // Advance well past 2 s — the timer was cleared, so nothing fires.
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(localStorage.getItem("dividimos_tour_completed_A")).toBeNull();
    // Celebration was reset; g2 is back at step 0.
    expect(screen.queryByText("Pronto!")).not.toBeInTheDocument();
    expect(screen.getByText("Seu saldo")).toBeInTheDocument();
  });

  it("user switch during celebration does not hide B or write either key", async () => {
    const { rerender } = render(<OnboardingTour userId="A" identityGeneration={1} />);

    for (let i = 0; i < 3; i++) {
      await settleRecalc();
      fireEvent.click(screen.getByText("Próximo"));
    }
    await settleRecalc();
    fireEvent.click(screen.getByText("Concluir"));
    expect(screen.getByText("Pronto!")).toBeInTheDocument();

    // A → B before the 2 s timer.
    rerender(<OnboardingTour userId="B" identityGeneration={2} />);

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(localStorage.getItem("dividimos_tour_completed_A")).toBeNull();
    expect(localStorage.getItem("dividimos_tour_completed_B")).toBeNull();
    // B is visible at step 0 — not hidden by A's pending celebration.
    expect(screen.queryByText("Pronto!")).not.toBeInTheDocument();
    expect(screen.getByText("Seu saldo")).toBeInTheDocument();
  });

  it("pending recalc timer does not publish the old rect after a gen change", async () => {
    const { rerender } = render(<OnboardingTour userId="A" identityGeneration={1} />);
    await settleRecalc();
    expect(screen.getByText("Seu saldo")).toBeInTheDocument();

    // Advance to step 1 and settle its rect.
    fireEvent.click(screen.getByText("Próximo"));
    await settleRecalc();
    expect(screen.getByText("Ações rápidas")).toBeInTheDocument();

    // Advance to step 2 WITHOUT settling — leave the 350 ms recalc pending.
    fireEvent.click(screen.getByText("Próximo"));

    // Gen change clears the pending timer and resets step to 0.
    rerender(<OnboardingTour userId="A" identityGeneration={2} />);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // The old step-2 rect was never published; step 0 is showing.
    expect(screen.getByText("Seu saldo")).toBeInTheDocument();
    expect(screen.queryByText("Quem deve o quê")).not.toBeInTheDocument();
  });

  it("resize and scroll after a boundary do not publish a stale spotlight", async () => {
    const { rerender } = render(<OnboardingTour userId="A" identityGeneration={1} />);
    await settleRecalc();
    fireEvent.click(screen.getByText("Próximo"));
    await settleRecalc();
    expect(screen.getByText("Ações rápidas")).toBeInTheDocument();

    // Boundary: A → null hides the overlay.
    rerender(<OnboardingTour userId={null} identityGeneration={2} />);
    expect(screen.queryByText("Ações rápidas")).not.toBeInTheDocument();

    // Dispatch resize and scroll — listeners were removed, nothing publishes.
    act(() => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("scroll"));
    });

    expect(screen.queryByText("Ações rápidas")).not.toBeInTheDocument();
    expect(screen.queryByText("Seu saldo")).not.toBeInTheDocument();
  });

  // ---- Retained happy-path for an unchanged owner ----

  it("skip completes the tour for the current owner", async () => {
    render(<OnboardingTour userId="A" identityGeneration={1} />);
    await settleRecalc();
    fireEvent.click(screen.getByLabelText("Pular tour"));
    expect(localStorage.getItem("dividimos_tour_completed_A")).toBe("true");
    expect(screen.queryByText("Seu saldo")).not.toBeInTheDocument();
  });

  it("final-step celebration completes the tour for the current owner", async () => {
    render(<OnboardingTour userId="A" identityGeneration={1} />);

    for (let i = 0; i < 3; i++) {
      await settleRecalc();
      fireEvent.click(screen.getByText("Próximo"));
    }
    await settleRecalc();

    fireEvent.click(screen.getByText("Concluir"));
    expect(screen.getByText("Pronto!")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(localStorage.getItem("dividimos_tour_completed_A")).toBe("true");
    expect(screen.queryByText("Pronto!")).not.toBeInTheDocument();
    expect(screen.queryByText("Seu saldo")).not.toBeInTheDocument();
  });
});
