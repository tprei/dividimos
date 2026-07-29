import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FinancialCompatibilityGate } from "./financial-compatibility-gate";
import { fetchFinancialCompatibility } from "@/lib/financial-compatibility";

vi.mock("@/lib/financial-compatibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/financial-compatibility")>();
  return { ...actual, fetchFinancialCompatibility: vi.fn() };
});

vi.mock("@/lib/capacitor", () => ({
  getNativeVersionCode: vi.fn().mockResolvedValue(null),
}));

const mockedFetch = vi.mocked(fetchFinancialCompatibility);

beforeEach(() => {
  mockedFetch.mockReset();
});

describe("FinancialCompatibilityGate", () => {
  it("renders a loading state before the check resolves", () => {
    mockedFetch.mockReturnValue(new Promise(() => {}));
    render(
      <FinancialCompatibilityGate>
        <div data-testid="app-content">app</div>
      </FinancialCompatibilityGate>,
    );
    expect(screen.queryByTestId("app-content")).not.toBeInTheDocument();
  });

  it("renders children once the check reports compatible", async () => {
    mockedFetch.mockResolvedValue({ compatible: true });
    render(
      <FinancialCompatibilityGate>
        <div data-testid="app-content">app</div>
      </FinancialCompatibilityGate>,
    );
    await waitFor(() => expect(screen.getByTestId("app-content")).toBeInTheDocument());
  });

  it("blocks children and shows a maintenance message on maintenance", async () => {
    mockedFetch.mockResolvedValue({ compatible: false, issue: { code: "maintenance" } });
    render(
      <FinancialCompatibilityGate>
        <div data-testid="app-content">app</div>
      </FinancialCompatibilityGate>,
    );
    await waitFor(() => expect(screen.getByText(/manutenção/i)).toBeInTheDocument());
    expect(screen.queryByTestId("app-content")).not.toBeInTheDocument();
  });

  it("blocks children and shows an update message on native_outdated", async () => {
    mockedFetch.mockResolvedValue({
      compatible: false,
      issue: { code: "native_outdated", minimumNativeVersionCode: 2 },
    });
    render(
      <FinancialCompatibilityGate>
        <div data-testid="app-content">app</div>
      </FinancialCompatibilityGate>,
    );
    await waitFor(() => expect(screen.getByText(/atualize pela loja/i)).toBeInTheDocument());
    expect(screen.queryByTestId("app-content")).not.toBeInTheDocument();
  });

  it("blocks children and shows a retry action on unreachable, never falling open", async () => {
    mockedFetch.mockResolvedValue({ compatible: false, issue: { code: "unreachable" } });
    render(
      <FinancialCompatibilityGate>
        <div data-testid="app-content">app</div>
      </FinancialCompatibilityGate>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /tentar novamente/i })).toBeInTheDocument());
    expect(screen.queryByTestId("app-content")).not.toBeInTheDocument();
  });
});
