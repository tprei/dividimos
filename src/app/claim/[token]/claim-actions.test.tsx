import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClaimActions } from "./claim-actions";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: vi.fn().mockResolvedValue({ error: null }),
  }),
}));

beforeEach(() => {
  pushMock.mockClear();
});

describe("ClaimActions", () => {
  it("shows waiting message when expense is not active", () => {
    render(
      <ClaimActions
        token="abc-123"
        expenseId="exp-1"
        isAuthenticated
        expenseStatus="draft"
      />,
    );

    expect(screen.getByText("Aguardando ativacao da despesa")).toBeInTheDocument();
  });

  it("shows login button when not authenticated", () => {
    render(
      <ClaimActions
        token="abc-123"
        expenseId="exp-1"
        isAuthenticated={false}
        expenseStatus="active"
      />,
    );

    expect(screen.getByText("Criar conta e confirmar")).toBeInTheDocument();
  });

  it("redirects to auth with next param when login button clicked", async () => {
    const user = userEvent.setup();
    render(
      <ClaimActions
        token="abc-123"
        expenseId="exp-1"
        isAuthenticated={false}
        expenseStatus="active"
      />,
    );

    await user.click(screen.getByText("Criar conta e confirmar"));
    expect(pushMock).toHaveBeenCalledWith("/auth?next=%2Fclaim%2Fabc-123");
  });

  it("shows confirm button when authenticated and active", () => {
    render(
      <ClaimActions
        token="abc-123"
        expenseId="exp-1"
        isAuthenticated
        expenseStatus="active"
      />,
    );

    expect(screen.getByText("Confirmar meu lugar")).toBeInTheDocument();
  });

  it("calls claim RPC and redirects on success", async () => {
    const user = userEvent.setup();
    render(
      <ClaimActions
        token="abc-123"
        expenseId="exp-1"
        isAuthenticated
        expenseStatus="active"
      />,
    );

    await user.click(screen.getByText("Confirmar meu lugar"));
    expect(pushMock).toHaveBeenCalledWith("/app/bill/exp-1");
  });
});
