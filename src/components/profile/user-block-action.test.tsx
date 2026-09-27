import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerError } from "@/lib/sync/errors";
import { useAppStore } from "@/stores/app-store";
import type { UserProfile } from "@/types/ledger";
import { UserBlockAction } from "./user-block-action";

const blockUserMock = vi.hoisted(() => vi.fn<(userId: string) => Promise<void>>());
const unblockUserMock = vi.hoisted(() => vi.fn<(userId: string) => Promise<void>>());
const loadUserBlocksMock = vi.hoisted(() => vi.fn<() => Promise<UserProfile[]>>());

vi.mock("@/lib/sync/user-blocks", () => ({
  blockUser: (userId: string) => blockUserMock(userId),
  unblockUser: (userId: string) => unblockUserMock(userId),
  loadUserBlocks: () => loadUserBlocksMock(),
}));

const target: UserProfile = { id: "u-target", handle: "alvo", name: "Alvo", avatarUrl: null, isBot: false };

beforeEach(() => {
  useAppStore.getState().reset();
  blockUserMock.mockReset();
  unblockUserMock.mockReset();
  loadUserBlocksMock.mockReset().mockResolvedValue([]);
});

describe("UserBlockAction", () => {
  it("stays disabled until the block list loads", async () => {
    const pending = Promise.withResolvers<UserProfile[]>();
    loadUserBlocksMock.mockReturnValueOnce(pending.promise);
    render(<UserBlockAction target={target} />);

    expect(screen.getByRole("button", { name: /Bloquear pessoa/ })).toBeDisabled();
    pending.resolve([]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Bloquear pessoa/ })).toBeEnabled());
  });

  it("blocks only after confirmation", async () => {
    blockUserMock.mockImplementation(async () => {
      useAppStore.getState().applyUserBlocks([target]);
    });
    const user = userEvent.setup();
    render(<UserBlockAction target={target} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Bloquear pessoa/ })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: /Bloquear pessoa/ }));
    expect(blockUserMock).not.toHaveBeenCalled();
    const confirmButtons = screen.getAllByRole("button", { name: "Bloquear pessoa" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(blockUserMock).toHaveBeenCalledWith(target.id));
    await waitFor(() => expect(screen.getByRole("button", { name: /Desbloquear pessoa/ })).toBeInTheDocument());
  });

  it("keeps the confirmation open with the error when the server refuses", async () => {
    blockUserMock.mockRejectedValue(new LedgerError("unauthenticated"));
    const user = userEvent.setup();
    render(<UserBlockAction target={target} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Bloquear pessoa/ })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: /Bloquear pessoa/ }));
    const confirmButtons = screen.getAllByRole("button", { name: "Bloquear pessoa" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(useAppStore.getState().blockedUsers).toEqual([]);
  });
});
