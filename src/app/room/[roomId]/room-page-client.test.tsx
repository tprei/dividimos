import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentRoomView } from "@/types/assignment-room";

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  me: null as { id: string; name: string } | null,
  memberToken: null as string | null,
  joinToken: null as string | null,
  detachAuth: vi.fn(),
  stopRealtime: vi.fn(),
  attachAuth: vi.fn(),
  startRealtime: vi.fn(),
  refresh: vi.fn(),
  join: vi.fn(),
  joinAccount: vi.fn(),
  authGeneration: vi.fn(),
  claim: vi.fn(),
  removeParticipant: vi.fn(),
  rotateJoin: vi.fn(),
  close: vi.fn(),
  cancel: vi.fn(),
  finalize: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: mocks.back }) }));
vi.mock("@/stores/app-store", () => ({
  useAppStore: (selector: (state: { me: typeof mocks.me }) => unknown) =>
    selector({ me: mocks.me }),
}));
vi.mock("@/lib/sync/auth", () => ({ attachAuthListener: mocks.attachAuth }));
vi.mock("@/lib/sync/client", () => ({ getAuthGeneration: mocks.authGeneration }));
vi.mock("@/lib/sync/assignment-room-realtime", () => ({
  startAssignmentRoomRealtime: mocks.startRealtime,
}));
vi.mock("@/lib/sync/assignment-rooms", () => ({
  getAssignmentRoomMemberToken: () => mocks.memberToken,
  getAssignmentRoomJoinToken: () => mocks.joinToken,
  getAssignmentRoomJoinAccount: mocks.joinAccount,
  refreshAssignmentRoom: mocks.refresh,
  joinAssignmentRoom: mocks.join,
  setAssignmentRoomClaim: mocks.claim,
  removeAssignmentRoomParticipant: mocks.removeParticipant,
  rotateAssignmentRoomJoin: mocks.rotateJoin,
  closeAssignmentRoom: mocks.close,
  cancelAssignmentRoom: mocks.cancel,
  finalizeAssignmentRoom: mocks.finalize,
}));
vi.mock("@/components/assignment-room/room-join", () => ({
  RoomJoin: ({
    identity,
    onRetryIdentity,
    onJoin,
    errorMessage,
  }: {
    identity: { status: string; name?: string | null };
    onRetryIdentity: () => void;
    onJoin: (name: string) => void;
    errorMessage?: string | null;
  }) => (
    <section>
      <p>{`identidade:${identity.status}`}</p>
      {identity.status === "account" && <p>{identity.name ?? "sem-nome"}</p>}
      {errorMessage && <p role="alert">{errorMessage}</p>}
      <button type="button" onClick={onRetryIdentity}>
        Tentar novamente
      </button>
      <button
        type="button"
        onClick={() => onJoin(identity.status === "account" ? "" : "Bia")}
      >
        Entrar
      </button>
    </section>
  ),
}));
vi.mock("@/components/assignment-room/room-board", () => ({
  RoomBoard: ({
    view,
    onBack,
    onClaim,
    claimError,
    inviteOpen,
    onInviteOpenChange,
    inviteError,
    onRotateInvite,
  }: {
    view: AssignmentRoomView;
    onBack: () => void;
    onClaim: (itemId: string, participantId: string, ticks: number) => Promise<boolean>;
    claimError: { itemId: string; participantId: string; message: string } | null;
    inviteOpen: boolean;
    onInviteOpenChange: (open: boolean) => void;
    inviteError: string | null;
    onRotateInvite: () => void;
  }) => (
    <section>
      <p>{`${view.role}:${view.room.status}`}</p>
      <p>{inviteOpen ? "convite-aberto" : "convite-fechado"}</p>
      {claimError && (
        <p role="alert">{`${claimError.itemId}:${claimError.participantId}`}</p>
      )}
      {inviteError && <p role="alert">{inviteError}</p>}
      <button type="button" onClick={onBack}>Voltar</button>
      <button type="button" onClick={() => onClaim(ITEM_ID, PARTICIPANT_ID, 120_000)}>
        Escolher
      </button>
      <button type="button" onClick={() => onInviteOpenChange(false)}>Fechar convite</button>
      <button type="button" onClick={onRotateInvite}>Rotacionar</button>
    </section>
  ),
}));
vi.mock("@/components/assignment-room/room-review", () => ({
  RoomReview: ({ onEditClaims, onFinalize }: { onEditClaims: () => void; onFinalize: (payload: never) => void }) => (
    <section>
      <p>Revisar conta</p>
      <button type="button" onClick={onEditClaims}>Corrigir escolhas</button>
      <button type="button" onClick={() => onFinalize({} as never)}>Confirmar</button>
    </section>
  ),
}));
vi.mock("@/components/assignment-room/room-breakdown", () => ({
  RoomBreakdown: () => <p>Conta registrada</p>,
}));

import { useAssignmentRoomStore } from "@/stores/assignment-room-store";
import { RoomPageClient } from "./room-page-client";

const ROOM_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-000000000002";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000003";
const INVITE = `armj1_${"A".repeat(43)}`;

function roomView(
  role: AssignmentRoomView["role"] = "participant",
  status: AssignmentRoomView["room"]["status"] = "open",
): AssignmentRoomView {
  const base: AssignmentRoomView = {
    role: "participant",
    room: {
      id: ROOM_ID,
      revision: 4,
      status,
      title: "Bar da esquina",
      occurredOn: "2026-09-19",
      serviceFeeBasisPoints: 0,
      fixedFeeCents: 0,
      totalCents: 1_000,
      selfParticipantId: PARTICIPANT_ID,
      items: [{
        id: ITEM_ID,
        ordinal: 0,
        revision: 2,
        description: "Prato",
        quantityMilliunits: 1_000,
        unitPriceCents: 1_000,
        totalPriceCents: 1_000,
      }],
      participants: [{
        id: PARTICIPANT_ID,
        ordinal: 0,
        displayName: "Bia",
        avatarUrl: null,
        isGuest: true,
        removed: false,
      }],
      claims: [],
      topic: null,
      currentBill: null,
    },
  };
  if (role === "participant") return base;
  return {
    ...base,
    role: "host",
    groupTarget: { kind: "new", name: "Bar da esquina" },
    participantRefs: [],
  };
}

beforeEach(() => {
  useAssignmentRoomStore.getState().reset();
  window.history.replaceState(null, "", "/");
  mocks.me = null;
  mocks.memberToken = null;
  mocks.joinToken = null;
  for (const mock of Object.values(mocks)) {
    if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
  }
  mocks.attachAuth.mockReturnValue(mocks.detachAuth);
  mocks.startRealtime.mockReturnValue(mocks.stopRealtime);
  mocks.joinAccount.mockResolvedValue(null);
  mocks.authGeneration.mockReturnValue(1);
});

describe("RoomPageClient", () => {
  it("clears the invite fragment before showing the anonymous join form without reading the room", async () => {
    window.history.replaceState(null, "", `/room/${ROOM_ID}#${INVITE}`);

    render(<StrictMode><RoomPageClient roomId={ROOM_ID} /></StrictMode>);

    expect(await screen.findByText("identidade:guest")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.attachAuth).toHaveBeenCalledTimes(2);
  });

  it("joins with the one-time fragment and starts room recovery with the member capability", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/room/${ROOM_ID}#${INVITE}`);
    mocks.join.mockImplementation(async () => {
      mocks.memberToken = `armm1_${"B".repeat(43)}`;
      useAssignmentRoomStore.getState().install(roomView());
    });
    mocks.refresh.mockResolvedValue(roomView());

    render(<RoomPageClient roomId={ROOM_ID} />);
    await user.click(await screen.findByRole("button", { name: "Entrar" }));

    expect(mocks.join).toHaveBeenCalledWith({ roomId: ROOM_ID, joinToken: INVITE, displayName: "Bia" });
    expect(await screen.findByText("participant:open")).toBeInTheDocument();
    await waitFor(() => expect(mocks.startRealtime).toHaveBeenCalledWith(ROOM_ID));
  });

  it("resolves the join identity as a named account only while the session matches", async () => {
    mocks.me = { id: "user-1", name: "Ana" };
    mocks.joinAccount.mockResolvedValue({ id: "user-1" });
    window.history.replaceState(null, "", `/room/${ROOM_ID}#${INVITE}`);

    render(<RoomPageClient roomId={ROOM_ID} />);

    expect(screen.getByText("identidade:loading")).toBeInTheDocument();
    expect(await screen.findByText("identidade:account")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();

    mocks.me = null;
    mocks.joinAccount.mockResolvedValue({ id: "user-9" });
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("sem-nome")).toBeInTheDocument();
  });

  it("never replaces the current form with a stale identity result", async () => {
    const stale = Promise.withResolvers<{ id: string } | null>();
    mocks.joinAccount.mockImplementationOnce(() => stale.promise);
    window.history.replaceState(null, "", `/room/${ROOM_ID}#${INVITE}`);

    render(<RoomPageClient roomId={ROOM_ID} />);
    expect(screen.getByText("identidade:loading")).toBeInTheDocument();

    // The retry bumps the identity counter and the auth generation, so the
    // still-pending first read must be discarded instead of overwriting the
    // form with a previous account.
    mocks.authGeneration.mockReturnValue(2);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.joinAccount).toHaveBeenCalledTimes(2);

    await act(async () => {
      stale.resolve({ id: "user-1" });
    });
    expect(await screen.findByText("identidade:guest")).toBeInTheDocument();
    expect(screen.queryByText("identidade:account")).not.toBeInTheDocument();
  });

  it("restores a host room, submits revisioned claims, and disposes both listeners", async () => {
    const user = userEvent.setup();
    mocks.memberToken = null;
    mocks.joinToken = INVITE;
    mocks.refresh.mockImplementation(async () => {
      useAssignmentRoomStore.getState().install(roomView("host"));
      useAssignmentRoomStore.getState().setConnected(ROOM_ID, true);
    });

    const { unmount } = render(<RoomPageClient roomId={ROOM_ID} />);

    expect(await screen.findByText("host:open")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Escolher" }));
    expect(mocks.claim).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      itemId: ITEM_ID,
      participantId: PARTICIPANT_ID,
      expectedItemRevision: 2,
      ticks: 120_000,
    });

    unmount();
    expect(mocks.stopRealtime).toHaveBeenCalledTimes(1);
    expect(mocks.detachAuth).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected claim scoped to the item and participant", async () => {
    const user = userEvent.setup();
    mocks.joinToken = INVITE;
    mocks.refresh.mockImplementation(async () => {
      useAssignmentRoomStore.getState().install(roomView("host"));
      useAssignmentRoomStore.getState().setConnected(ROOM_ID, true);
    });
    mocks.claim.mockRejectedValue(new Error("boom"));

    render(<RoomPageClient roomId={ROOM_ID} />);
    expect(await screen.findByText("host:open")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Escolher" }));
    expect(
      await screen.findByText(`${ITEM_ID}:${PARTICIPANT_ID}`),
    ).toBeInTheDocument();
  });

  it("reports rotation failures inside the invitation instead of the page banner", async () => {
    const user = userEvent.setup();
    mocks.memberToken = `armm1_${"B".repeat(43)}`;
    mocks.refresh.mockImplementation(async () => {
      useAssignmentRoomStore.getState().install(roomView("host"));
      useAssignmentRoomStore.getState().setConnected(ROOM_ID, true);
    });
    mocks.rotateJoin.mockRejectedValue(new Error("boom"));

    render(<RoomPageClient roomId={ROOM_ID} />);
    expect(await screen.findByText("host:open")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rotacionar" }));
    expect(await screen.findByText("Deu ruim aqui. Tente de novo em instantes.")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("opens the invitation from the one-time ?invite=1 flag and strips it from history", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/room/${ROOM_ID}?invite=1&tab=itens`);
    mocks.memberToken = `armm1_${"B".repeat(43)}`;
    mocks.refresh.mockImplementation(async () => {
      useAssignmentRoomStore.getState().install(roomView("host"));
      useAssignmentRoomStore.getState().setConnected(ROOM_ID, true);
    });

    render(<StrictMode><RoomPageClient roomId={ROOM_ID} /></StrictMode>);

    expect(await screen.findByText("host:open")).toBeInTheDocument();
    expect(screen.getByText("convite-aberto")).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=itens");

    await user.click(screen.getByRole("button", { name: "Fechar convite" }));
    expect(screen.getByText("convite-fechado")).toBeInTheDocument();
  });

  it("does not auto-open the invitation on reload without the flag", async () => {
    mocks.memberToken = `armm1_${"B".repeat(43)}`;
    mocks.refresh.mockImplementation(async () => {
      useAssignmentRoomStore.getState().install(roomView("host"));
      useAssignmentRoomStore.getState().setConnected(ROOM_ID, true);
    });

    render(<StrictMode><RoomPageClient roomId={ROOM_ID} /></StrictMode>);

    expect(await screen.findByText("host:open")).toBeInTheDocument();
    expect(screen.getByText("convite-fechado")).toBeInTheDocument();
  });

  it("lets the host return from closed review to correct choices", async () => {
    const user = userEvent.setup();
    mocks.refresh.mockImplementation(async () => {
      useAssignmentRoomStore.getState().install(roomView("host", "closed"));
    });

    render(<RoomPageClient roomId={ROOM_ID} />);

    expect(await screen.findByText("Revisar conta")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Corrigir escolhas" }));
    expect(screen.getByText("host:closed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.getByText("Revisar conta")).toBeInTheDocument();
  });
});
