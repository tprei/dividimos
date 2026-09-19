import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentRoomView } from "@/types/assignment-room";

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  memberToken: null as string | null,
  joinToken: null as string | null,
  detachAuth: vi.fn(),
  stopRealtime: vi.fn(),
  attachAuth: vi.fn(),
  startRealtime: vi.fn(),
  refresh: vi.fn(),
  join: vi.fn(),
  claim: vi.fn(),
  removeParticipant: vi.fn(),
  rotateJoin: vi.fn(),
  close: vi.fn(),
  cancel: vi.fn(),
  finalize: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: mocks.back }) }));
vi.mock("@/stores/app-store", () => ({ useAppStore: () => null }));
vi.mock("@/lib/sync/auth", () => ({ attachAuthListener: mocks.attachAuth }));
vi.mock("@/lib/sync/assignment-room-realtime", () => ({
  startAssignmentRoomRealtime: mocks.startRealtime,
}));
vi.mock("@/lib/sync/assignment-rooms", () => ({
  getAssignmentRoomMemberToken: () => mocks.memberToken,
  getAssignmentRoomJoinToken: () => mocks.joinToken,
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
  RoomJoin: ({ onJoin, errorMessage }: { onJoin: (name: string) => void; errorMessage?: string | null }) => (
    <section>
      <p>Entrar na divisão</p>
      {errorMessage && <p role="alert">{errorMessage}</p>}
      <button type="button" onClick={() => onJoin("Bia")}>Entrar</button>
    </section>
  ),
}));
vi.mock("@/components/assignment-room/room-board", () => ({
  RoomBoard: ({
    view,
    onBack,
    onClaim,
  }: {
    view: AssignmentRoomView;
    onBack: () => void;
    onClaim: (itemId: string, participantId: string, ticks: number) => void;
  }) => (
    <section>
      <p>{`${view.role}:${view.room.status}`}</p>
      <button type="button" onClick={onBack}>Voltar</button>
      <button type="button" onClick={() => onClaim(ITEM_ID, PARTICIPANT_ID, 120_000)}>Escolher</button>
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
  mocks.memberToken = null;
  mocks.joinToken = null;
  for (const mock of Object.values(mocks)) {
    if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
  }
  mocks.attachAuth.mockReturnValue(mocks.detachAuth);
  mocks.startRealtime.mockReturnValue(mocks.stopRealtime);
});

describe("RoomPageClient", () => {
  it("clears the invite fragment before showing the anonymous join form without reading the room", async () => {
    window.history.replaceState(null, "", `/room/${ROOM_ID}#${INVITE}`);

    render(<StrictMode><RoomPageClient roomId={ROOM_ID} /></StrictMode>);

    expect(await screen.findByText("Entrar na divisão")).toBeInTheDocument();
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
