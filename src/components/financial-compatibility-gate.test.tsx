import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FinancialCompatibilityGate } from "./financial-compatibility-gate";
import { fetchFinancialCompatibility } from "@/lib/financial-compatibility";
import { getNativeVersionCode } from "@/lib/capacitor";

vi.mock("@/lib/financial-compatibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/financial-compatibility")>();
  return { ...actual, fetchFinancialCompatibility: vi.fn() };
});

vi.mock("@/lib/capacitor", () => ({
  getNativeVersionCode: vi.fn().mockResolvedValue({ onNative: false }),
}));

const mockedFetch = vi.mocked(fetchFinancialCompatibility);
const mockedGetNativeVersionCode = vi.mocked(getNativeVersionCode);

beforeEach(() => {
  mockedFetch.mockReset();
  mockedGetNativeVersionCode.mockReset();
  mockedGetNativeVersionCode.mockResolvedValue({ onNative: false });
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

  it("blocks children and shows a verify-again message on native_unknown, never falling open", async () => {
    mockedFetch.mockResolvedValue({
      compatible: false,
      issue: { code: "native_unknown" },
    });
    render(
      <FinancialCompatibilityGate>
        <div data-testid="app-content">app</div>
      </FinancialCompatibilityGate>,
    );
    await waitFor(() => expect(screen.getByText(/verificar a versão/i)).toBeInTheDocument());
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

  it("passes a native-unknown signal to the compatibility check when the native version lookup throws, never defaulting to web", async () => {
    mockedGetNativeVersionCode.mockRejectedValue(new Error("plugin unavailable"));
    mockedFetch.mockResolvedValue({ compatible: true });
    render(
      <FinancialCompatibilityGate>
        <div data-testid="app-content">app</div>
      </FinancialCompatibilityGate>,
    );
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith({ onNative: true, versionCode: null }));
  });
});
