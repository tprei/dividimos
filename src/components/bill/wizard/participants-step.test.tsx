import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParticipantsStep } from "./participants-step";
import type { Me, GroupSnapshot } from "@/types/ledger";
import type { User } from "@/types";

vi.mock("@/components/bill/add-participant-by-handle", () => ({
  AddParticipantByHandle: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="add-by-handle">
      <button onClick={onCancel}>Cancelar</button>
    </div>
  ),
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
    members: members.map((m) => ({
      groupId: id,
      userId: m.userId,
      status: m.status,
      invitedBy: null,
      acceptedAt: null,
      user: { id: m.userId, handle: m.handle, name: m.name, avatarUrl: null },
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
  it("renders participants list with no group selected", () => {
    render(<ParticipantsStep {...baseProps} participants={[meUser, otherUser]} />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Você")).toBeInTheDocument();
  });

  it("shows handle-based add and guest buttons when no group selected", () => {
    render(<ParticipantsStep {...baseProps} />);

    expect(screen.getByText("Por @handle")).toBeInTheDocument();
    expect(screen.getByText("Adicionar convidado")).toBeInTheDocument();
  });

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

  it("shows selected group members as toggle chips and marks invited ones as pending", () => {
    const groups = [
      makeSnapshot("group-1", "Churrasco", [
        { userId: "user-2", name: "Bob", handle: "bob", status: "accepted" },
        { userId: "user-3", name: "Carol", handle: "carol", status: "invited" },
      ]),
    ];
    render(
      <ParticipantsStep
        {...baseProps}
        selectedGroupId="group-1"
        groups={groups}
        participants={[meUser, otherUser]}
      />,
    );

    expect(screen.getByText("Churrasco")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.getByText("convite pendente")).toBeInTheDocument();
    expect(screen.getByText("Quem participou desta conta?")).toBeInTheDocument();
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
    expect(onAddParticipant).toHaveBeenCalledWith({ id: "user-3", handle: "carol", name: "Carol", avatarUrl: null });
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

  it("renders guests section when guests exist", () => {
    render(<ParticipantsStep {...baseProps} guests={[{ id: "guest-1", name: "Guest Dan" }]} />);

    expect(screen.getByText("Guest Dan")).toBeInTheDocument();
    expect(screen.getByText("Convidado")).toBeInTheDocument();
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

  it("opens guest form and submits guest name", async () => {
    const onAddGuest = vi.fn();
    const user = userEvent.setup();
    render(<ParticipantsStep {...baseProps} onAddGuest={onAddGuest} />);

    await user.click(screen.getByText("Adicionar convidado"));
    expect(screen.getByPlaceholderText("Nome do convidado")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Nome do convidado"), "Dan");
    await user.keyboard("{Enter}");
    expect(onAddGuest).toHaveBeenCalledWith("Dan");
  });

  it("shows contact picker button when supported", () => {
    render(<ParticipantsStep {...baseProps} hasContactPicker={true} />);

    expect(screen.getByText("Dos contatos do celular")).toBeInTheDocument();
  });

  it("hides contact picker button when not supported", () => {
    render(<ParticipantsStep {...baseProps} hasContactPicker={false} />);

    expect(screen.queryByText("Dos contatos do celular")).not.toBeInTheDocument();
  });
});
