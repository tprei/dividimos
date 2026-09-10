import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupSelect } from "./group-select";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Me, UserProfile } from "@/types/ledger";

const DM_GROUP_ID = "02e8a10a-1fed-499c-9bc9-64beb59229ff";

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice Souza",
  avatarUrl: null,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

const carol: UserProfile = { id: "user-2", handle: "carol", name: "Carol Souza", avatarUrl: null };

type SnapshotOverrides = Partial<Omit<GroupSnapshot, "group">> & {
  group?: Partial<GroupSnapshot["group"]>;
};

function snapshot(overrides: SnapshotOverrides = {}): GroupSnapshot {
  const base: GroupSnapshot = {
    group: {
      id: "g1",
      kind: "group",
      name: "Jantar",
      creatorId: me.id,
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
    expenseCount: 0,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    pairwiseEdges: [],
  };
  return { ...base, ...overrides, group: { ...base.group, ...overrides.group } };
}

function member(groupId: string, user: UserProfile): GroupSnapshot["members"][number] {
  return {
    groupId,
    userId: user.id,
    status: "accepted",
    invitedBy: null,
    acceptedAt: null,
    user,
  };
}

function renderSelect(props: Partial<Parameters<typeof GroupSelect>[0]> = {}) {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const onCreateValueChange = vi.fn();
  const onToggleCreateGroup = vi.fn();
  render(
    <GroupSelect
      value={null}
      groups={[]}
      onSelect={onSelect}
      createValue=""
      onCreateValueChange={onCreateValueChange}
      createGroupEnabled={false}
      onToggleCreateGroup={onToggleCreateGroup}
      dmEligible={false}
      {...props}
    />,
  );
  return { user, onSelect, onCreateValueChange, onToggleCreateGroup };
}

describe("GroupSelect", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    useAppStore.setState({ me });
  });

  it("labels a dm group with the counterparty name instead of its id", async () => {
    const dm = snapshot({
      group: { id: DM_GROUP_ID, kind: "dm", name: "", dmUserA: me.id, dmUserB: carol.id },
      members: [member(DM_GROUP_ID, me), member(DM_GROUP_ID, carol)],
    });
    const { user } = renderSelect({ value: DM_GROUP_ID, groups: [dm] });

    const trigger = screen.getByRole("combobox", { name: "Grupo" });
    expect(trigger).toHaveTextContent("Carol Souza");
    expect(trigger).not.toHaveTextContent(DM_GROUP_ID);

    await user.click(trigger);
    expect(screen.getByRole("option", { name: "Carol Souza" })).toBeInTheDocument();
  });

  it("keeps regular group names and the fixed option values", async () => {
    const group = snapshot({ group: { id: "g1", kind: "group", name: "Jantar" } });
    const { user } = renderSelect({ groups: [group], dmEligible: true });

    await user.click(screen.getByRole("combobox", { name: "Grupo" }));
    expect(screen.getByRole("option", { name: "Escolha um grupo" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Jantar" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Novo grupo…" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Conversa direta" })).toBeInTheDocument();
  });

  it("reports the selected group id and create toggle to the parent", async () => {
    const group = snapshot({ group: { id: "g1", kind: "group", name: "Jantar" } });
    const { user, onSelect, onToggleCreateGroup } = renderSelect({ groups: [group] });

    await user.click(screen.getByRole("combobox", { name: "Grupo" }));
    await user.click(screen.getByRole("option", { name: "Novo grupo…" }));

    expect(onSelect).toHaveBeenCalledWith("create");
    expect(onToggleCreateGroup).toHaveBeenCalledWith(true);
  });
});
