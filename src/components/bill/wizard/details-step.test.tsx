import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { toIsoDate } from "@/lib/date-shortcuts";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { DetailsStep, initialStartProgress } from "./details-step";
import { __resetBackHandlerStackForTests, runBackHandlers } from "@/lib/capacitor/back-handler";

vi.mock("@/components/bill/add-participant-by-handle", () => ({
  AddParticipantByHandle: () => null,
}));

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

const churras: GroupSnapshot = {
  group: {
    id: "g-churras",
    kind: "group",
    name: "Churras da firma",
    creatorId: me.id,
    dmUserA: null,
    dmUserB: null,
    ledgerVersion: 1,
    createdAt: "",
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
  lastActivityAt: "",
  pairwiseEdges: [],
};

interface HostProps {
  initialTitle?: string;
  initialGroup?: string | null;
  groups?: GroupSnapshot[];
  groupsPending?: boolean;
  createFallback?: string;
  dmEligible?: boolean;
}

function Host({
  initialTitle = "",
  initialGroup = null,
  groups = [churras],
  groupsPending = false,
  createFallback = "",
  dmEligible = false,
}: HostProps) {
  const [title, setTitle] = useState(initialTitle);
  const [occurredOn, setOccurredOn] = useState(toIsoDate(new Date()));
  const [groupId, setGroupId] = useState<string | null>(initialGroup);
  const [progress, setProgress] = useState(() => initialStartProgress(initialTitle));
  return (
    <DetailsStep
      progress={progress}
      onProgressChange={setProgress}
      groupsPending={groupsPending}
      title={title}
      onTitleChange={setTitle}
      occurredOn={occurredOn}
      onOccurredOnChange={setOccurredOn}
      group={{
        value: groupId,
        groups,
        onSelect: setGroupId,
        createValue: "",
        createFallback,
        onCreateValueChange: vi.fn(),
        createGroupEnabled: false,
        onToggleCreateGroup: vi.fn(),
        dmEligible,
      }}
      participants={{
        me,
        participants: [{ id: me.id, email: me.email, handle: me.handle, name: me.name, pixKeyType: "email", pixKeyHint: "", onboarded: true, createdAt: "" }],
        guests: [],
        selectedGroupId: groupId,
        groups: [churras],
        createGroup: { enabled: false, name: "" },
        onToggleCreateGroup: vi.fn(),
        onCreateGroupName: vi.fn(),
        onSelectGroup: setGroupId,
        onAddParticipant: vi.fn(),
        onRemoveParticipant: vi.fn(),
        onAddGuest: vi.fn(),
        onRemoveGuest: vi.fn(),
        hasContactPicker: false,
        onPickContacts: vi.fn(),
      }}
    />
  );
}

beforeEach(() => {
  __resetBackHandlerStackForTests();
});

describe("DetailsStep guided start", () => {
  it("asks the name, the date and the group in turn, then shows only the people under a summary", async () => {
    const user = userEvent.setup();
    render(<Host />);

    expect(screen.queryByRole("button", { name: "Por @handle" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Nome da conta" }), "pizzada{Enter}");

    await user.click(await screen.findByRole("button", { name: "Ontem" }));
    await user.click(await screen.findByRole("button", { name: /Churras da firma/ }));

    expect(await screen.findByRole("button", { name: "Por @handle" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Nome da conta" })).toHaveValue("pizzada");
    expect(screen.getByRole("button", { name: "Data: Ontem" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grupo: Churras da firma" })).toBeInTheDocument();
  });

  it("opens a named bill with a group already chosen straight on the people", () => {
    render(<Host initialTitle="Jantar" initialGroup="g-churras" />);

    expect(screen.getByRole("button", { name: "Por @handle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data: Hoje" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grupo: Churras da firma" })).toBeInTheDocument();
  });

  it("skips the group question when the group was chosen before the name", async () => {
    const user = userEvent.setup();
    render(<Host initialGroup="g-churras" />);

    await user.type(screen.getByRole("textbox", { name: "Nome da conta" }), "pizzada{Enter}");
    await user.click(await screen.findByRole("button", { name: "Hoje" }));

    expect(await screen.findByRole("button", { name: "Por @handle" })).toBeInTheDocument();
    expect(screen.queryByText("De qual grupo?")).not.toBeInTheDocument();
  });

  it("returns to the people after re-answering the date from the summary", async () => {
    const user = userEvent.setup();
    render(<Host initialTitle="Jantar" initialGroup="g-churras" />);

    await user.click(screen.getByRole("button", { name: "Data: Hoje" }));
    await user.click(await screen.findByRole("button", { name: "Ontem" }));

    expect(await screen.findByRole("button", { name: "Por @handle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data: Ontem" })).toBeInTheDocument();
  });

  it("keeps the group question while the groups are still loading", async () => {
    const user = userEvent.setup();
    render(<Host groups={[]} groupsPending />);

    await user.type(screen.getByRole("textbox", { name: "Nome da conta" }), "pizzada{Enter}");
    await user.click(await screen.findByRole("button", { name: "Hoje" }));

    expect(await screen.findByText("De qual grupo?")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando grupos…");
  });

  it("goes back from the people to the last question answered, not a skipped one", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.type(screen.getByRole("textbox", { name: "Nome da conta" }), "pizzada{Enter}");
    await user.click(await screen.findByRole("button", { name: "Hoje" }));
    await user.click(await screen.findByRole("button", { name: "Pular" }));
    expect(await screen.findByRole("button", { name: "Por @handle" })).toBeInTheDocument();

    act(() => {
      runBackHandlers();
    });

    expect(await screen.findByText("Quando foi?")).toBeInTheDocument();
  });

  it("labels an unchosen group by where the bill will land", () => {
    const { unmount } = render(<Host initialTitle="Jantar" dmEligible />);
    expect(screen.getByRole("button", { name: "Grupo: Conversa direta" })).toBeInTheDocument();
    unmount();

    render(<Host initialTitle="Jantar" initialGroup="create" createFallback="Alice e Bia" />);
    expect(screen.getByRole("button", { name: "Grupo: Alice e Bia" })).toBeInTheDocument();
  });
});
