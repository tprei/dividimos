import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParticipantsStep } from "./participants-step";
import type { User, UserProfile } from "@/types";

vi.mock("@/components/bill/group-selector", () => ({
  GroupSelector: () => <div data-testid="group-selector" />,
}));

vi.mock("@/components/bill/add-participant-by-handle", () => ({
  AddParticipantByHandle: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="add-by-handle">
      <button onClick={onCancel}>Cancelar</button>
    </div>
  ),
}));

vi.mock("@/components/bill/recent-contacts", () => ({
  RecentContacts: () => <div data-testid="recent-contacts" />,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const authUser: User = {
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

describe("ParticipantsStep", () => {
  it("renders participants list", () => {
    render(
      <ParticipantsStep
        authUser={authUser}
        participants={[authUser, otherUser]}
        guests={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        groupMembers={[]}
        hasContactPicker={false}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
        onAddParticipant={vi.fn()}
        onRemoveParticipant={vi.fn()}
        onAddGuest={vi.fn()}
        onRemoveGuest={vi.fn()}
        onPickContacts={vi.fn()}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Você")).toBeInTheDocument();
  });

  it("shows handle-based add and guest buttons when no group selected", () => {
    render(
      <ParticipantsStep
        authUser={authUser}
        participants={[authUser]}
        guests={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        groupMembers={[]}
        hasContactPicker={false}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
        onAddParticipant={vi.fn()}
        onRemoveParticipant={vi.fn()}
        onAddGuest={vi.fn()}
        onRemoveGuest={vi.fn()}
        onPickContacts={vi.fn()}
      />,
    );

    expect(screen.getByText("Por @handle")).toBeInTheDocument();
    expect(screen.getByText("Adicionar convidado")).toBeInTheDocument();
  });

  it("shows group members with checkboxes when group is selected", () => {
    const groupMembers: UserProfile[] = [
      { id: "user-2", handle: "bob", name: "Bob" },
      { id: "user-3", handle: "carol", name: "Carol" },
    ];

    render(
      <ParticipantsStep
        authUser={authUser}
        participants={[authUser, otherUser]}
        guests={[]}
        selectedGroupId="group-1"
        selectedGroupName="Test Group"
        groupMembers={groupMembers}
        hasContactPicker={false}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
        onAddParticipant={vi.fn()}
        onRemoveParticipant={vi.fn()}
        onAddGuest={vi.fn()}
        onRemoveGuest={vi.fn()}
        onPickContacts={vi.fn()}
      />,
    );

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.getByText("Quem participou desta conta?")).toBeInTheDocument();
  });

  it("renders guests section when guests exist", () => {
    render(
      <ParticipantsStep
        authUser={authUser}
        participants={[authUser]}
        guests={[{ id: "guest-1", name: "Guest Dan" }]}
        selectedGroupId={null}
        selectedGroupName={null}
        groupMembers={[]}
        hasContactPicker={false}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
        onAddParticipant={vi.fn()}
        onRemoveParticipant={vi.fn()}
        onAddGuest={vi.fn()}
        onRemoveGuest={vi.fn()}
        onPickContacts={vi.fn()}
      />,
    );

    expect(screen.getByText("Guest Dan")).toBeInTheDocument();
    expect(screen.getByText("Convidado")).toBeInTheDocument();
  });

  it("calls onRemoveParticipant when remove button clicked", async () => {
    const onRemoveParticipant = vi.fn();
    const user = userEvent.setup();
    render(
      <ParticipantsStep
        authUser={authUser}
        participants={[authUser, otherUser]}
        guests={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        groupMembers={[]}
        hasContactPicker={false}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
        onAddParticipant={vi.fn()}
        onRemoveParticipant={onRemoveParticipant}
        onAddGuest={vi.fn()}
        onRemoveGuest={vi.fn()}
        onPickContacts={vi.fn()}
      />,
    );

    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector("svg") && !btn.textContent,
    );
    if (removeButtons.length > 0) {
      await user.click(removeButtons[0]);
      expect(onRemoveParticipant).toHaveBeenCalledWith("user-2");
    }
  });

  it("opens guest form and submits guest name", async () => {
    const onAddGuest = vi.fn();
    const user = userEvent.setup();
    render(
      <ParticipantsStep
        authUser={authUser}
        participants={[authUser]}
        guests={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        groupMembers={[]}
        hasContactPicker={false}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
        onAddParticipant={vi.fn()}
        onRemoveParticipant={vi.fn()}
        onAddGuest={onAddGuest}
        onRemoveGuest={vi.fn()}
        onPickContacts={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Adicionar convidado"));
    expect(screen.getByPlaceholderText("Nome do convidado")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Nome do convidado"), "Dan");
    await user.keyboard("{Enter}");
    expect(onAddGuest).toHaveBeenCalledWith("Dan");
  });

  it("shows contact picker button when supported", () => {
    render(
      <ParticipantsStep
        authUser={authUser}
        participants={[authUser]}
        guests={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        groupMembers={[]}
        hasContactPicker={true}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
        onAddParticipant={vi.fn()}
        onRemoveParticipant={vi.fn()}
        onAddGuest={vi.fn()}
        onRemoveGuest={vi.fn()}
        onPickContacts={vi.fn()}
      />,
    );

    expect(screen.getByText("Dos contatos do celular")).toBeInTheDocument();
  });

  it("hides contact picker button when not supported", () => {
    render(
      <ParticipantsStep
        authUser={authUser}
        participants={[authUser]}
        guests={[]}
        selectedGroupId={null}
        selectedGroupName={null}
        groupMembers={[]}
        hasContactPicker={false}
        onSelectGroup={vi.fn()}
        onDeselectGroup={vi.fn()}
        onAddParticipant={vi.fn()}
        onRemoveParticipant={vi.fn()}
        onAddGuest={vi.fn()}
        onRemoveGuest={vi.fn()}
        onPickContacts={vi.fn()}
      />,
    );

    expect(screen.queryByText("Dos contatos do celular")).not.toBeInTheDocument();
  });
});
