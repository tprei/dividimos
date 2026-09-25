import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/stores/app-store";
import { GroupAvatarEditor } from "./group-avatar-editor";

const mocks = vi.hoisted(() => ({
  updateGroupAvatar: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/sync/group-avatar", () => ({
  updateGroupAvatar: mocks.updateGroupAvatar,
}));

vi.mock("react-hot-toast", () => ({
  default: { error: mocks.toastError },
}));

const groupId = "group-1";

beforeEach(() => {
  useAppStore.getState().reset();
  useAppStore.setState({
    groups: {
      [groupId]: {
        group: {
          id: groupId,
          kind: "group",
          name: "Viagem",
          creatorId: "alice",
          dmUserA: null,
          dmUserB: null,
          ledgerVersion: 1,
          createdAt: "2026-01-01T00:00:00Z",
        },
        members: [],
        balances: [],
        guests: [],
        settlements: [],
        recentExpenses: [],
        lastEventId: 0,
        unreadCount: 0,
        lastMessage: null,
        lastActivityAt: null,
        expenseCount: 0,
        pairwiseEdges: [],
        overview: { avatar: { kind: "initials" }, spending: null },
      },
    },
  });
  vi.clearAllMocks();
  mocks.updateGroupAvatar.mockResolvedValue(undefined);
});

describe("GroupAvatarEditor", () => {
  it("saves a selected emoji through the sync boundary", async () => {
    const user = userEvent.setup();
    render(<GroupAvatarEditor groupId={groupId} open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: "Casa" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(mocks.updateGroupAvatar).toHaveBeenCalledWith(groupId, { kind: "emoji", emoji: "🏠" });
  });

  it("closes with Escape when no changes would be lost", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<GroupAvatarEditor groupId={groupId} open onOpenChange={onOpenChange} />);

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the selected avatar and shows an error when saving fails", async () => {
    mocks.updateGroupAvatar.mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();
    render(<GroupAvatarEditor groupId={groupId} open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: "Gato" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Gato" })).toBeChecked();
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it("uses initials for reset", async () => {
    useAppStore.setState((state) => ({
      groups: {
        ...state.groups,
        [groupId]: { ...state.groups[groupId], overview: { avatar: { kind: "emoji", emoji: "🎉" }, spending: null } },
      },
    }));
    const user = userEvent.setup();
    render(<GroupAvatarEditor groupId={groupId} open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Remover" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(mocks.updateGroupAvatar).toHaveBeenCalledWith(groupId, { kind: "initials" });
  });

  it("keeps unsaved input until discarding is confirmed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<GroupAvatarEditor groupId={groupId} open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole("radio", { name: "Casa" }));
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    expect(screen.getByRole("radio", { name: "Casa" })).toBeChecked();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
