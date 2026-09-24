import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JoinActions } from "./join-actions";
import { joinViaLink } from "@/lib/sync/mutations-group";
import { LedgerError } from "@/lib/sync/errors";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  joinViaLink: vi.fn(),
}));

const joinMock = vi.mocked(joinViaLink);

beforeEach(() => {
  pushMock.mockClear();
  joinMock.mockReset();
  joinMock.mockResolvedValue({ groupId: "group-1", ledgerVersion: 2, eventId: 7 });
});

const defaultProps = {
  token: "abc-123",
  isAuthenticated: true,
};

describe("JoinActions", () => {

  it("redirects to auth with next param when login button clicked", async () => {
    const user = userEvent.setup();
    render(
      <JoinActions
        {...defaultProps}
        isAuthenticated={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Entrar no grupo" }));
    expect(pushMock).toHaveBeenCalledWith("/auth?next=%2Fjoin%2Fabc-123");
  });


  it("joins through the sync mutation and redirects to the joined group", async () => {
    const user = userEvent.setup();
    render(<JoinActions {...defaultProps} />);

    await user.click(screen.getByText("Entrar no grupo"));

    expect(joinMock).toHaveBeenCalledWith("abc-123");
    expect(pushMock).toHaveBeenCalledWith("/app/groups/group-1");
  });

  it("offers the existing group when the invitation belongs to a current member", async () => {
    joinMock.mockResolvedValue({ groupId: "group-1", ledgerVersion: 5, eventId: null });
    const user = userEvent.setup();
    render(<JoinActions {...defaultProps} />);

    await user.click(screen.getByText("Entrar no grupo"));
    expect(screen.getByRole("status")).toHaveTextContent("Você já faz parte deste grupo.");
    await user.click(screen.getByRole("button", { name: "Abrir grupo" }));
    expect(pushMock).toHaveBeenCalledWith("/app/groups/group-1");
  });

  it("shows the ledger message for an invalid link and re-enables the button", async () => {
    joinMock.mockRejectedValue(new LedgerError("invalid_link"));
    const user = userEvent.setup();
    render(<JoinActions {...defaultProps} />);

    await user.click(screen.getByText("Entrar no grupo"));

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText("Esse convite não é mais válido.")).toBeInTheDocument();
    expect(screen.getByText("Entrar no grupo")).toBeEnabled();
  });

  it("shows the removal message when the caller was excluded from the group", async () => {
    joinMock.mockRejectedValue(new LedgerError("member_excluded"));
    const user = userEvent.setup();
    render(<JoinActions {...defaultProps} />);

    await user.click(screen.getByText("Entrar no grupo"));

    expect(screen.getByText("Essa pessoa foi removida do grupo.")).toBeInTheDocument();
  });

  it("shows the shared fallback for an unrecognized failure", async () => {
    joinMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<JoinActions {...defaultProps} />);

    await user.click(screen.getByText("Entrar no grupo"));

    expect(
      screen.getByText("Deu ruim aqui. Tente de novo em instantes."),
    ).toBeInTheDocument();
  });
});
