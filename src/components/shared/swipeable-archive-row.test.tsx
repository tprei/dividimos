import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SwipeableArchiveRow, type SwipeableArchiveRowProps } from "./swipeable-archive-row";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: toast }));

type ArchiveAction = SwipeableArchiveRowProps["action"];

function renderRow(action: ArchiveAction) {
  const onArchive = vi.fn();
  const onUnarchive = vi.fn();
  render(
    <SwipeableArchiveRow action={action} onArchive={onArchive} onUnarchive={onUnarchive}>
      <p>Carol Souza</p>
    </SwipeableArchiveRow>,
  );
  return { onArchive, onUnarchive };
}

function revealActions() {
  fireEvent.click(screen.getByRole("button", { name: "Mostrar ações" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SwipeableArchiveRow", () => {
  it("renders the child without any archive control when action is null", () => {
    renderRow(null);

    expect(screen.getByText("Carol Souza")).toBeInTheDocument();
    expect(screen.getByText("Carol Souza").closest("[data-swipe-row]")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Arquivar")).not.toBeInTheDocument();
    expect(screen.queryByText("Desarquivar")).not.toBeInTheDocument();
  });

  it("reveals the archive action through the accessible toggle and archives once", () => {
    const { onArchive, onUnarchive } = renderRow("archive");

    expect(screen.queryByRole("button", { name: "Arquivar" })).not.toBeInTheDocument();

    revealActions();
    const action = screen.getByRole("button", { name: "Arquivar" });
    expect(action).toHaveAttribute("aria-disabled", "false");

    fireEvent.click(action, { detail: 1 });

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onUnarchive).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("unarchives from the revealed action", () => {
    const { onArchive, onUnarchive } = renderRow("unarchive");

    expect(screen.queryByRole("button", { name: "Desarquivar" })).not.toBeInTheDocument();

    revealActions();
    fireEvent.click(screen.getByRole("button", { name: "Desarquivar" }), { detail: 1 });

    expect(onUnarchive).toHaveBeenCalledTimes(1);
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("keeps blocked_by_balance inert and surfaces the reason", () => {
    const { onArchive, onUnarchive } = renderRow("blocked_by_balance");

    revealActions();
    const action = screen.getByRole("button", { name: "Arquivar Saldo pendente" });
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Saldo pendente")).toBeInTheDocument();

    fireEvent.click(action, { detail: 1 });

    expect(onArchive).not.toHaveBeenCalled();
    expect(onUnarchive).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Acerte as contas antes de arquivar.");
  });

  it("activates exactly once for a keyboard-style detail 0 click", () => {
    const { onArchive, onUnarchive } = renderRow("archive");

    revealActions();
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }), { detail: 0 });

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onUnarchive).not.toHaveBeenCalled();
  });

  it("shows the blocked reason once for a keyboard-style detail 0 click", () => {
    renderRow("blocked_by_balance");

    revealActions();
    fireEvent.click(screen.getByRole("button", { name: "Arquivar Saldo pendente" }), { detail: 0 });

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("rearms between two keyboard activations", () => {
    const { onUnarchive } = renderRow("unarchive");

    revealActions();
    const action = screen.getByRole("button", { name: "Desarquivar" });
    fireEvent.keyDown(action, { key: "Enter" });
    fireEvent.click(action, { detail: 0 });
    expect(onUnarchive).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(action, { key: "Enter" });
    fireEvent.click(action, { detail: 0 });
    expect(onUnarchive).toHaveBeenCalledTimes(2);
  });
});
