import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { OnboardingTour } from "./onboarding-tour";

vi.mock("@/hooks/use-onboarding-tour", () => ({
  useOnboardingTour: vi.fn(),
}));

import { useOnboardingTour } from "@/hooks/use-onboarding-tour";

const mockCompleteTour = vi.fn();
const mockUseOnboardingTour = vi.mocked(useOnboardingTour);

function setupTourTargets() {
  const targets = [
    { attr: "balance-card", text: "Balance" },
    { attr: "quick-actions", text: "Actions" },
    { attr: "debt-lists", text: "Listas" },
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
    mockCompleteTour.mockClear();
    tourElements = setupTourTargets();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const el of tourElements) {
      el.remove();
    }
    tourElements = [];
  });

  it("does not render when shouldShow is false", () => {
    mockUseOnboardingTour.mockReturnValue({
      shouldShow: false,
      completeTour: mockCompleteTour,
      resetTour: vi.fn(),
    });

    render(<OnboardingTour userId="user-1" />);
    expect(screen.queryByText("Seu saldo")).not.toBeInTheDocument();
  });

  it("renders first step when shouldShow is true", async () => {
    mockUseOnboardingTour.mockReturnValue({
      shouldShow: true,
      completeTour: mockCompleteTour,
      resetTour: vi.fn(),
    });

    render(<OnboardingTour userId="user-1" />);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText("Seu saldo")).toBeInTheDocument();
    expect(
      screen.getByText("Seu saldo geral, mais quanto você tem a pagar e a receber."),
    ).toBeInTheDocument();
  });

  it("advances to next step on Próximo click", async () => {
    mockUseOnboardingTour.mockReturnValue({
      shouldShow: true,
      completeTour: mockCompleteTour,
      resetTour: vi.fn(),
    });

    render(<OnboardingTour userId="user-1" />);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    fireEvent.click(screen.getByText("Próximo"));

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText("Ações rápidas")).toBeInTheDocument();
  });

  it("calls completeTour on skip", async () => {
    mockUseOnboardingTour.mockReturnValue({
      shouldShow: true,
      completeTour: mockCompleteTour,
      resetTour: vi.fn(),
    });

    render(<OnboardingTour userId="user-1" />);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    fireEvent.click(screen.getByLabelText("Pular tour"));
    expect(mockCompleteTour).toHaveBeenCalledOnce();
  });

  it("shows Concluir on last step", async () => {
    mockUseOnboardingTour.mockReturnValue({
      shouldShow: true,
      completeTour: mockCompleteTour,
      resetTour: vi.fn(),
    });

    render(<OnboardingTour userId="user-1" />);

    // Advance through all 4 steps
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.click(screen.getByText("Próximo"));
    }

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText("Concluir")).toBeInTheDocument();
    expect(screen.getByText("Navegação")).toBeInTheDocument();
  });

  it("shows celebration and completes on final click", async () => {
    mockUseOnboardingTour.mockReturnValue({
      shouldShow: true,
      completeTour: mockCompleteTour,
      resetTour: vi.fn(),
    });

    render(<OnboardingTour userId="user-1" />);

    // Advance through all steps
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.click(screen.getByText("Próximo"));
    }

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    fireEvent.click(screen.getByText("Concluir"));

    expect(screen.getByText("Pronto!")).toBeInTheDocument();
    expect(
      screen.getByText("Agora é só dividir as contas."),
    ).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(mockCompleteTour).toHaveBeenCalledOnce();
  });

  it("shows step counter text (Próximo button present on non-last steps)", async () => {
    mockUseOnboardingTour.mockReturnValue({
      shouldShow: true,
      completeTour: mockCompleteTour,
      resetTour: vi.fn(),
    });

    render(<OnboardingTour userId="user-1" />);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // First step shows "Próximo", not "Concluir"
    expect(screen.getByText("Próximo")).toBeInTheDocument();
    expect(screen.queryByText("Concluir")).not.toBeInTheDocument();
  });

  it("skips a step whose anchor is missing instead of painting a blank overlay", async () => {
    mockUseOnboardingTour.mockReturnValue({
      shouldShow: true,
      completeTour: mockCompleteTour,
      resetTour: vi.fn(),
    });
    for (const el of tourElements) {
      if (el.getAttribute("data-tour") !== "nav-bar") el.remove();
    }

    render(<OnboardingTour userId="user-1" />);

    for (let i = 0; i < 4; i++) {
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
    }

    expect(screen.getByText("Navegação")).toBeInTheDocument();
    expect(screen.queryByText("Seu saldo")).not.toBeInTheDocument();
  });

  it("completes the tour when no anchor is on the page", async () => {
    mockUseOnboardingTour.mockReturnValue({
      shouldShow: true,
      completeTour: mockCompleteTour,
      resetTour: vi.fn(),
    });
    for (const el of tourElements) el.remove();

    render(<OnboardingTour userId="user-1" />);

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
    }

    expect(screen.queryByText("Navegação")).not.toBeInTheDocument();
    expect(mockCompleteTour).toHaveBeenCalled();
  });
});
