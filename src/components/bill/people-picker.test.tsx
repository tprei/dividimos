import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeoplePicker } from "./people-picker";
import type { PeoplePickerProps } from "./people-picker";
import { lookupUserByHandle } from "@/lib/sync/mutations-group";
import { useAppStore } from "@/stores/app-store";
import type { GroupMember, GroupSnapshot, Me, MemberStatus, UserProfile } from "@/types/ledger";

vi.mock("@/lib/sync/mutations-group", () => ({
  lookupUserByHandle: vi.fn(),
}));

const lookup = vi.mocked(lookupUserByHandle);

const me: Me = {
  id: "user-1",
  email: "alice@test.com",
  handle: "alice",
  name: "Alice",
  avatarUrl: null,
  isBot: false,
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

const meProfile: UserProfile = { id: me.id, handle: me.handle, name: me.name, avatarUrl: null, isBot: false };

function person(id: string, handle: string, name: string): UserProfile {
  return { id, handle, name, avatarUrl: null, isBot: false };
}

function member(groupId: string, user: UserProfile, status: MemberStatus): GroupMember {
  return { groupId, userId: user.id, status, invitedBy: null, acceptedAt: null, user };
}

function snapshot(groupId: string, kind: "group" | "dm", members: GroupMember[]): GroupSnapshot {
  return {
    group: {
      id: groupId,
      kind,
      name: groupId,
      creatorId: me.id,
      dmUserA: kind === "dm" ? me.id : null,
      dmUserB: kind === "dm" ? members[1].userId : null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    dmCounterparty: null,
    members,
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
    archivedAt: null,
    formerMembers: [],
    financialHistorySharedAt: null,
  };
}

function seedStore(groups: GroupSnapshot[], blockedUsers: UserProfile[] = []): void {
  useAppStore.setState({
    groups: Object.fromEntries(groups.map((group) => [group.group.id, group])),
    groupOrder: groups.map((group) => group.group.id),
    blockedUsers,
  });
}

function renderPicker(props: Partial<PeoplePickerProps> = {}) {
  const onAddPerson = vi.fn();
  const onAddGuest = vi.fn();
  render(
    <PeoplePicker
      me={me}
      selectedIds={[]}
      showSuggestions
      onAddPerson={onAddPerson}
      onAddGuest={onAddGuest}
      {...props}
    />,
  );
  return { onAddPerson, onAddGuest };
}

function field() {
  return screen.getByRole("textbox", { name: "Adicionar pessoas" });
}

function typeQuery(value: string): void {
  fireEvent.change(field(), { target: { value } });
}

function pressEnter(): void {
  fireEvent.keyDown(field(), { key: "Enter" });
}

async function settleLookup(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  lookup.mockReset();
  useAppStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PeoplePicker", () => {
  it("suggests known people from groups and DMs, excluding the viewer, blocked users and invited members", () => {
    const bob = person("user-2", "bob", "Bob");
    const carol = person("user-3", "carol", "Carol");
    const duda = person("user-5", "duda", "Duda");
    const zeca = person("user-6", "zeca", "Zeca");
    seedStore([
      snapshot("g1", "group", [
        member("g1", meProfile, "accepted"),
        member("g1", bob, "accepted"),
        member("g1", carol, "invited"),
        member("g1", zeca, "accepted"),
      ]),
      snapshot("dm1", "dm", [member("dm1", meProfile, "accepted"), member("dm1", duda, "invited")]),
    ], [zeca]);
    renderPicker();

    expect(screen.getByRole("button", { name: "Adicionar Bob" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar Duda" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar Carol" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar Zeca" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar Alice" })).not.toBeInTheDocument();
  });

  it("shows an added person as non-interactive and never offers them to onAddPerson again", async () => {
    const bob = person("user-2", "bob", "Bob");
    seedStore([snapshot("g1", "group", [member("g1", meProfile, "accepted"), member("g1", bob, "accepted")])]);
    const user = userEvent.setup();
    const { onAddPerson } = renderPicker({ selectedIds: [me.id, bob.id] });

    await user.type(field(), "bob");

    expect(screen.getByText("Na conta")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar Bob" })).not.toBeInTheDocument();

    pressEnter();
    expect(onAddPerson).not.toHaveBeenCalled();
  });

  it("adds the accent-insensitive first local match on Enter and resets the field", async () => {
    const joao = person("user-2", "jsilva", "João Silva");
    seedStore([snapshot("g1", "group", [member("g1", meProfile, "accepted"), member("g1", joao, "accepted")])]);
    const user = userEvent.setup();
    const { onAddPerson } = renderPicker();

    await user.type(field(), "joao{Enter}");

    expect(onAddPerson).toHaveBeenCalledWith(joao);
    expect(field()).toHaveValue("");
    expect(field()).toHaveFocus();
  });

  it("adds a guest with the trimmed query on an explicit guest-row click", async () => {
    seedStore([]);
    const user = userEvent.setup();
    const { onAddGuest, onAddPerson } = renderPicker();

    await user.type(field(), "  Dita  ");
    await user.click(screen.getByRole("button", { name: "Adicionar Dita como convidado" }));

    expect(onAddGuest).toHaveBeenCalledTimes(1);
    expect(onAddGuest).toHaveBeenCalledWith("Dita");
    expect(onAddPerson).not.toHaveBeenCalled();
  });

  it("adds the known person explicitly on click when the typed name matches, not a guest", async () => {
    const ana = person("user-2", "anapaula", "Ana Paula");
    seedStore([snapshot("g1", "group", [member("g1", meProfile, "accepted"), member("g1", ana, "accepted")])]);
    const user = userEvent.setup();
    const { onAddPerson, onAddGuest } = renderPicker();

    await user.type(field(), "ana");

    expect(screen.getByRole("button", { name: "Adicionar Ana Paula" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Adicionar Ana Paula" }));
    expect(onAddPerson).toHaveBeenCalledWith(ana);
    expect(onAddGuest).not.toHaveBeenCalled();
  });

  it("fires no lookup and offers no guest for an exact known handle", async () => {
    const ana = person("user-2", "anapaula", "Ana Paula");
    seedStore([snapshot("g1", "group", [member("g1", meProfile, "accepted"), member("g1", ana, "accepted")])]);
    vi.useFakeTimers();
    const { onAddPerson } = renderPicker();

    typeQuery("@anapaula");
    await settleLookup(1000);

    expect(lookup).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Adicionar Ana Paula" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /como convidado/ })).not.toBeInTheDocument();

    pressEnter();
    expect(onAddPerson).toHaveBeenCalledWith(ana);
  });

  it("never offers a guest row for an @query", async () => {
    seedStore([]);
    vi.useFakeTimers();
    renderPicker();
    lookup.mockResolvedValue(null);

    typeQuery("@zezin");
    await settleLookup(500);

    expect(screen.getByText("Ninguém com @zezin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /como convidado/ })).not.toBeInTheDocument();
  });

  it("makes no speculative lookup for a plain name and searches only after the explicit action row", async () => {
    seedStore([]);
    vi.useFakeTimers();
    renderPicker();

    typeQuery("maria");
    await settleLookup(1000);
    expect(lookup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Buscar @maria" }));
    expect(field()).toHaveValue("@maria");

    lookup.mockResolvedValue(null);
    await settleLookup(500);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("maria", expect.any(AbortSignal));
  });

  it("never offers the viewer's own profile", async () => {
    seedStore([]);
    vi.useFakeTimers();
    const { onAddPerson } = renderPicker();

    typeQuery("@alice");
    await settleLookup(1000);

    expect(screen.getByText("Esse é você")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar Alice" })).not.toBeInTheDocument();
    expect(lookup).not.toHaveBeenCalled();

    pressEnter();
    expect(onAddPerson).not.toHaveBeenCalled();
  });

  it("resolves an explicit @handle to the exact profile only, never a local prefix match", async () => {
    const anaPaula = person("user-2", "ana_paula", "Ana Paula");
    const anaRemote = person("user-9", "ana", "Ana Souza");
    seedStore([snapshot("g1", "group", [member("g1", meProfile, "accepted"), member("g1", anaPaula, "accepted")])]);
    vi.useFakeTimers();
    const { onAddPerson } = renderPicker();
    let resolveLookup: ((profile: UserProfile | null) => void) | undefined;
    lookup.mockImplementation(
      () => new Promise<UserProfile | null>((resolve) => { resolveLookup = resolve; }),
    );

    typeQuery("@ana");
    await settleLookup(500);
    expect(lookup).toHaveBeenCalledTimes(1);

    pressEnter();
    expect(onAddPerson).not.toHaveBeenCalled();

    await act(async () => { resolveLookup?.(anaRemote); });
    expect(screen.getByRole("button", { name: "Adicionar Ana Souza" })).toBeInTheDocument();

    pressEnter();
    expect(onAddPerson).toHaveBeenCalledTimes(1);
    expect(onAddPerson).toHaveBeenCalledWith(anaRemote);
    expect(onAddPerson).not.toHaveBeenCalledWith(anaPaula);
  });

  it("never offers a blocked remote profile as an addable row or an Enter target", async () => {
    const zeca = person("user-6", "zeca_b", "Zeca Bloqueado");
    seedStore([], [zeca]);
    vi.useFakeTimers();
    const { onAddPerson } = renderPicker();
    lookup.mockResolvedValue(zeca);

    typeQuery("@zeca_b");
    await settleLookup(500);

    expect(screen.queryByRole("button", { name: "Adicionar Zeca Bloqueado" })).not.toBeInTheDocument();

    pressEnter();
    expect(onAddPerson).not.toHaveBeenCalled();
  });

  it("never adds a remote profile blocked after the lookup settled", async () => {
    const joana = person("user-7", "joana_x", "Joana");
    seedStore([]);
    vi.useFakeTimers();
    const { onAddPerson } = renderPicker();
    lookup.mockResolvedValue(joana);

    typeQuery("@joana_x");
    await settleLookup(500);

    useAppStore.setState({ blockedUsers: [joana] });
    await flush();

    pressEnter();
    expect(onAddPerson).not.toHaveBeenCalled();
  });

  it("activates the visible guest row on Enter once an @-less handle lookup settles not_found", async () => {
    seedStore([]);
    vi.useFakeTimers();
    const { onAddGuest } = renderPicker();
    lookup.mockResolvedValue(null);

    typeQuery("carla2");
    pressEnter();
    expect(onAddGuest).not.toHaveBeenCalled();

    await settleLookup(500);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Adicionar carla2 como convidado" })).toBeInTheDocument();

    pressEnter();
    expect(onAddGuest).toHaveBeenCalledTimes(1);
    expect(onAddGuest).toHaveBeenCalledWith("carla2");
  });

  it("keeps Enter a no-op for an @-less handle when the lookup failed", async () => {
    seedStore([]);
    vi.useFakeTimers();
    const { onAddGuest } = renderPicker();
    lookup.mockRejectedValue(new Error("offline"));

    typeQuery("carla2");
    await settleLookup(500);

    expect(lookup).toHaveBeenCalledTimes(1);
    pressEnter();
    expect(onAddGuest).not.toHaveBeenCalled();
  });
});
