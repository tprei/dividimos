import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParticipantsStep } from "./participants-step";
import type { Me, GroupSnapshot } from "@/types/ledger";
import type { User } from "@/types";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("react-hot-toast", () => ({
  default: { error: toastError, success: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const me: Me = {
  id: "user-1",
  email: "alice@test.com",
  handle: "alice",
  name: "Alice",
  avatarUrl: null,
  isBot: false,
  pixKeyType: "email",
  pixKeyHint: "",
  onboarded: true,
  notificationPreferences: {},
};

const meUser: User = {
  id: "user-1",
  email: "alice@test.com",
  handle: "alice",
  name: "Alice",
  pixKeyType: "email",
  pixKeyHint: "",
  onboarded: true,
  createdAt: "",
};

const otherUser: User = {
  id: "user-2",
  email: "",
  handle: "bob",
  name: "Bob",
  pixKeyType: "email",
  pixKeyHint: "",
  onboarded: true,
  createdAt: "",
};

function makeSnapshot(
  id: string,
  name: string,
  members: { userId: string; name: string; handle: string; status: "accepted" | "invited" }[],
): GroupSnapshot {
  return {
    group: {
      id,
      kind: "group",
      name,
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "",
    },
    dmCounterparty: null,
    members: members.map((m) => ({
      groupId: id,
      userId: m.userId,
      status: m.status,
      invitedBy: null,
      acceptedAt: null,
      user: { id: m.userId, handle: m.handle, name: m.name, avatarUrl: null, isBot: false },
    })),
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "",
    pairwiseEdges: [],
    archivedAt: null,
    formerMembers: [],
    financialHistorySharedAt: null,
  };
}

const baseProps = {
  me,
  participants: [meUser],
  guests: [] as { id: string; name: string }[],
  selectedGroupId: null as string | null,
  groups: [] as GroupSnapshot[],
  createGroup: { enabled: true, name: "Grupo" },
  onToggleCreateGroup: vi.fn(),
  onCreateGroupName: vi.fn(),
  onSelectGroup: vi.fn(),
  onAddParticipant: vi.fn(),
  onRemoveParticipant: vi.fn(),
  onAddGuest: vi.fn(),
  onRemoveGuest: vi.fn(),
  hasContactPicker: false,
  onPickContacts: vi.fn(),
};

describe("ParticipantsStep", () => {
  it("lists existing groups to pick from and reports the selection", async () => {
    const onSelectGroup = vi.fn();
    const groups = [
      makeSnapshot("group-1", "Churrasco", [{ userId: "user-2", name: "Bob", handle: "bob", status: "accepted" }]),
    ];
    const user = userEvent.setup();
    render(<ParticipantsStep {...baseProps} groups={groups} onSelectGroup={onSelectGroup} />);

    await user.click(screen.getByText("Churrasco"));
    expect(onSelectGroup).toHaveBeenCalledWith("group-1");
  });

  it("shows the create-group checkbox and editable name when no group is selected", async () => {
    const onToggleCreateGroup = vi.fn();
    const onCreateGroupName = vi.fn();
    const user = userEvent.setup();
    render(
      <ParticipantsStep
        {...baseProps}
        participants={[meUser, otherUser, { ...otherUser, id: "user-3", handle: "carol", name: "Carol" }]}
        createGroup={{ enabled: true, name: "Alice, Bob e Carol" }}
        onToggleCreateGroup={onToggleCreateGroup}
        onCreateGroupName={onCreateGroupName}
      />,
    );

    expect(screen.getByText("Criar grupo com essas pessoas")).toBeInTheDocument();
    const nameInput = screen.getByPlaceholderText("Nome do grupo");
    expect(nameInput).toHaveValue("Alice, Bob e Carol");

    await user.click(screen.getByLabelText("Criar grupo com essas pessoas"));
    expect(onToggleCreateGroup).toHaveBeenCalledWith(false);

    await user.type(nameInput, "!");
    expect(onCreateGroupName).toHaveBeenCalledWith("Alice, Bob e Carol!");
  });

  it("hides the create-group checkbox when exactly one other user and no guests (DM case)", () => {
    render(
      <ParticipantsStep {...baseProps} participants={[meUser, otherUser]} createGroup={{ enabled: false, name: "" }} />,
    );

    expect(screen.queryByText("Criar grupo com essas pessoas")).not.toBeInTheDocument();
  });

  it("toggles a group member chip through onAddParticipant / onRemoveParticipant", async () => {
    const onAddParticipant = vi.fn();
    const onRemoveParticipant = vi.fn();
    const groups = [
      makeSnapshot("group-1", "Churrasco", [
        { userId: "user-2", name: "Bob", handle: "bob", status: "accepted" },
        { userId: "user-3", name: "Carol", handle: "carol", status: "accepted" },
      ]),
    ];
    const user = userEvent.setup();
    render(
      <ParticipantsStep
        {...baseProps}
        selectedGroupId="group-1"
        groups={groups}
        participants={[meUser, otherUser]}
        onAddParticipant={onAddParticipant}
        onRemoveParticipant={onRemoveParticipant}
      />,
    );

    // Bob is already a participant -> the chip removes him.
    await user.click(screen.getByRole("button", { name: /Bob/ }));
    expect(onRemoveParticipant).toHaveBeenCalledWith("user-2");
    expect(onRemoveParticipant).not.toHaveBeenCalledWith("user-3");

    // Carol is not a participant yet -> the chip adds her profile.
    await user.click(screen.getByRole("button", { name: /Carol/ }));
    expect(onAddParticipant).toHaveBeenCalledWith({ id: "user-3", handle: "carol", name: "Carol", avatarUrl: null, isBot: false });
  });

  it("deselects the group when the X on the selected group is pressed", async () => {
    const onSelectGroup = vi.fn();
    const groups = [
      makeSnapshot("group-1", "Churrasco", [{ userId: "user-2", name: "Bob", handle: "bob", status: "accepted" }]),
    ];
    const user = userEvent.setup();
    render(
      <ParticipantsStep {...baseProps} selectedGroupId="group-1" groups={groups} onSelectGroup={onSelectGroup} />,
    );

    await user.click(screen.getByLabelText("Remover grupo selecionado"));
    expect(onSelectGroup).toHaveBeenCalledWith(null);
  });

  it("calls onRemoveParticipant when remove button clicked", async () => {
    const onRemoveParticipant = vi.fn();
    const user = userEvent.setup();
    render(
      <ParticipantsStep
        {...baseProps}
        participants={[meUser, otherUser]}
        onRemoveParticipant={onRemoveParticipant}
      />,
    );

    await user.click(screen.getByLabelText("Remover Bob"));
    expect(onRemoveParticipant).toHaveBeenCalledWith("user-2");
  });

  it("adds a guest from the people field", async () => {
    const onAddGuest = vi.fn();
    const user = userEvent.setup();
    render(<ParticipantsStep {...baseProps} onAddGuest={onAddGuest} />);

    await user.type(screen.getByRole("textbox", { name: "Adicionar pessoas" }), "Dan");
    await user.click(screen.getByRole("button", { name: "Adicionar Dan como convidado" }));

    expect(onAddGuest).toHaveBeenCalledWith("Dan");
  });

  it("removes a guest through onRemoveGuest", async () => {
    const onRemoveGuest = vi.fn();
    const user = userEvent.setup();
    render(
      <ParticipantsStep
        {...baseProps}
        guests={[{ id: "guest-1", name: "Dan" }]}
        onRemoveGuest={onRemoveGuest}
      />,
    );

    await user.click(screen.getByLabelText("Remover Dan"));
    expect(onRemoveGuest).toHaveBeenCalledWith("guest-1");
  });

  it("surfaces a toast when onPickContacts rejects", async () => {
    const onPickContacts = vi.fn().mockRejectedValue(new Error("plugin bridge missing"));
    const user = userEvent.setup();
    render(
      <ParticipantsStep {...baseProps} hasContactPicker={true} onPickContacts={onPickContacts} />,
    );

    await user.click(screen.getByRole("button", { name: "Dos contatos do celular" }));

    expect(toastError).toHaveBeenCalledWith("Não foi possível abrir os contatos. Tente novamente.");
  });

  it("disables the contact picker button while a pick is in flight", async () => {
    let resolvePick: (() => void) | undefined;
    const onPickContacts = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePick = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <ParticipantsStep {...baseProps} hasContactPicker={true} onPickContacts={onPickContacts} />,
    );

    await user.click(screen.getByRole("button", { name: "Dos contatos do celular" }));
    expect(screen.getByRole("button", { name: "Dos contatos do celular" })).toBeDisabled();

    resolvePick?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dos contatos do celular" })).toBeEnabled(),
    );
  });
});
