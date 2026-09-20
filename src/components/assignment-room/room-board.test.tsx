import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AssignmentRoomView } from "@/types/assignment-room";
import { RoomBoard } from "./room-board";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("qrcode", () => ({ default: { toCanvas: vi.fn() } }));

const noop = () => {};

function participantView(
  claims: AssignmentRoomView["room"]["claims"],
  status: AssignmentRoomView["room"]["status"] = "open",
): AssignmentRoomView {
  return {
    role: "participant",
    room: {
      id: "00000000-0000-4000-8000-000000000001",
      revision: 3,
      status,
      title: "Bar da esquina",
      occurredOn: "2026-09-19",
      serviceFeeBasisPoints: 1_000,
      fixedFeeCents: 1,
      totalCents: 6_601,
      selfParticipantId: "person-a",
      items: [
        {
          id: "beer",
          ordinal: 0,
          revision: 2,
          description: "Cerveja",
          quantityMilliunits: 3_000,
          unitPriceCents: 1_000,
          totalPriceCents: 3_000,
        },
        {
          id: "fries",
          ordinal: 1,
          revision: 1,
          description: "Batata",
          quantityMilliunits: 1_000,
          unitPriceCents: 3_000,
          totalPriceCents: 3_000,
        },
      ],
      participants: [
        { id: "person-a", ordinal: 0, displayName: "Bia", avatarUrl: null, isGuest: true, removed: false },
        { id: "person-b", ordinal: 1, displayName: "Caio", avatarUrl: null, isGuest: true, removed: false },
      ],
      claims,
      topic: null,
      currentBill: null,
    },
  };
}

function hostView(claims: AssignmentRoomView["room"]["claims"]): AssignmentRoomView {
  const base = participantView(claims);
  return {
    role: "host",
    room: base.room,
    groupTarget: { kind: "new", name: "Bar da esquina" },
    participantRefs: [],
  };
}

const boardProps = {
  connected: true,
  joinUrl: "https://dividimos.test/room/00000000-0000-4000-8000-000000000001#secret",
  pendingItemIds: [],
  onClaim: vi.fn(),
  onRotateInvite: noop,
  onRemoveParticipant: noop,
  onClose: noop,
  onCancel: noop,
};

describe("RoomBoard", () => {
  it("moves an exhausted personal claim to the editable assigned section", async () => {
    const user = userEvent.setup();
    const fullBeer = [{ itemId: "beer", participantId: "person-a", ticks: 360_000 }];
    const { rerender } = render(<RoomBoard view={participantView(fullBeer)} {...boardProps} />);

    const beer = screen.getByRole("heading", { name: "Cerveja" }).closest("article");
    expect(beer?.parentElement).toHaveAttribute("data-assignment-section", "assigned");
    expect(within(beer as HTMLElement).getByRole("button", { name: "Editar minha parte" })).toBeEnabled();
    expect(screen.queryByText("Controle da sala")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Editar escolhas de")).not.toBeInTheDocument();

    await user.click(within(beer as HTMLElement).getByRole("button", { name: "Editar minha parte" }));
    await user.click(screen.getByRole("button", { name: "Desfazer minha escolha" }));
    expect(boardProps.onClaim).toHaveBeenCalledWith("beer", "person-a", 0);

    rerender(<RoomBoard view={participantView([])} {...boardProps} />);
    expect(
      screen.getByRole("heading", { name: "Cerveja" }).closest("article")?.parentElement,
    ).toHaveAttribute("data-assignment-section", "available");
  });

  it("keeps host controls explicit and gates close on complete lines", () => {
    const { rerender } = render(<RoomBoard view={hostView([])} {...boardProps} />);

    expect(screen.getByText("Controle da sala")).toBeInTheDocument();
    expect(screen.getByLabelText("Editar escolhas de")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fechar escolhas" })).toBeDisabled();

    rerender(
      <RoomBoard
        view={hostView([
          { itemId: "beer", participantId: "person-a", ticks: 360_000 },
          { itemId: "fries", participantId: "person-b", ticks: 120_000 },
        ])}
        {...boardProps}
      />,
    );
    expect(screen.getByRole("button", { name: "Fechar escolhas" })).toBeEnabled();
  });

  it("blocks claims while reconnecting and keeps rejected availability visible", () => {
    render(
      <RoomBoard
        view={participantView([{ itemId: "beer", participantId: "person-b", ticks: 360_000 }])}
        {...boardProps}
        connected={false}
        claimError={{ itemId: "beer", message: "Outra pessoa ficou com a última unidade." }}
      />,
    );
    expect(screen.queryByText("Nenhum outro item disponível agora.")).not.toBeInTheDocument();

    expect(screen.getByRole("status")).toHaveTextContent("Reconectando");
    const beer = screen.getByRole("heading", { name: "Cerveja" }).closest("article");
    expect(within(beer as HTMLElement).getByRole("alert")).toHaveTextContent("última unidade");
    expect(within(beer as HTMLElement).getByRole("button", { name: "Escolher quantidade" })).toBeDisabled();
  });

  it("shows closed and terminal guest states without host actions", () => {
    const { rerender } = render(<RoomBoard view={participantView([], "closed")} {...boardProps} />);
    expect(screen.getByText("Aguardando confirmação")).toBeInTheDocument();
    expect(screen.queryByText("Controle da sala")).not.toBeInTheDocument();

    rerender(<RoomBoard view={participantView([], "finalized")} {...boardProps} />);
    expect(screen.getByText("Conta registrada")).toBeInTheDocument();
  });
});
