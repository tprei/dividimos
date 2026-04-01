import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JoinActions } from "./join-actions";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const rpcMock = vi.fn().mockResolvedValue({
  data: { group_id: "group-1", already_member: false },
  error: null,
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

beforeEach(() => {
  pushMock.mockClear();
  rpcMock.mockClear();
  rpcMock.mockResolvedValue({
    data: { group_id: "group-1", already_member: false },
    error: null,
  });
});

const defaultProps = {
  token: "abc-123",
  isAuthenticated: true,
  isInvalid: false,
  isExpired: false,
  isExhausted: false,
  isInactive: false,
};

describe("JoinActions", () => {
  it("shows unavailable message when link is inactive", () => {
    render(
      <JoinActions
        {...defaultProps}
        isInvalid
        isInactive
      />,
    );

    expect(screen.getByText("Convite indisponível")).toBeInTheDocument();
    expect(screen.getByText("Este convite foi desativado.")).toBeInTheDocument();
  });

  it("shows expired message when link is expired", () => {
    render(
      <JoinActions
        {...defaultProps}
        isInvalid
        isExpired
      />,
    );

    expect(screen.getByText("Este convite expirou.")).toBeInTheDocument();
  });

  it("shows exhausted message when link reached max uses", () => {
    render(
      <JoinActions
        {...defaultProps}
        isInvalid
        isExhausted
      />,
    );

    expect(
      screen.getByText("Este convite atingiu o limite de usos."),
    ).toBeInTheDocument();
  });

  it("shows login button when not authenticated", () => {
    render(
      <JoinActions
        {...defaultProps}
        isAuthenticated={false}
      />,
    );

    expect(
      screen.getByText("Criar conta e entrar no grupo"),
    ).toBeInTheDocument();
  });

  it("redirects to auth with next param when login button clicked", async () => {
    const user = userEvent.setup();
    render(
      <JoinActions
        {...defaultProps}
        isAuthenticated={false}
      />,
    );

    await user.click(screen.getByText("Criar conta e entrar no grupo"));
    expect(pushMock).toHaveBeenCalledWith("/auth?next=%2Fjoin%2Fabc-123");
  });

  it("shows join button when authenticated", () => {
    render(<JoinActions {...defaultProps} />);

    expect(screen.getByText("Entrar no grupo")).toBeInTheDocument();
  });

  it("calls join RPC and redirects on success", async () => {
    const user = userEvent.setup();
    render(<JoinActions {...defaultProps} />);

    await user.click(screen.getByText("Entrar no grupo"));

    expect(rpcMock).toHaveBeenCalledWith("join_group_via_link", {
      p_token: "abc-123",
    });
    expect(pushMock).toHaveBeenCalledWith("/app/groups/group-1");
  });

  it("redirects to group when already a member", async () => {
    rpcMock.mockResolvedValue({
      data: { group_id: "group-1", already_member: true },
      error: null,
    });
    const user = userEvent.setup();
    render(<JoinActions {...defaultProps} />);

    await user.click(screen.getByText("Entrar no grupo"));
    expect(pushMock).toHaveBeenCalledWith("/app/groups/group-1");
  });

  it("shows error when RPC returns invalid_token", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "invalid_token: invite link not found" },
    });
    const user = userEvent.setup();
    render(<JoinActions {...defaultProps} />);

    await user.click(screen.getByText("Entrar no grupo"));
    expect(
      screen.getByText("Convite inválido ou não encontrado."),
    ).toBeInTheDocument();
  });

  it("shows error when RPC returns link_expired", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "link_expired: this invite link has expired" },
    });
    const user = userEvent.setup();
    render(<JoinActions {...defaultProps} />);

    await user.click(screen.getByText("Entrar no grupo"));
    expect(screen.getByText("Este convite expirou.")).toBeInTheDocument();
  });

  it("shows generic error for unknown RPC errors", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "some unexpected error" },
    });
    const user = userEvent.setup();
    render(<JoinActions {...defaultProps} />);

    await user.click(screen.getByText("Entrar no grupo"));
    expect(
      screen.getByText("Erro ao entrar no grupo. Tente novamente."),
    ).toBeInTheDocument();
  });
});
