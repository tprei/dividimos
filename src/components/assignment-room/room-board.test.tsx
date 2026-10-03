import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AssignmentRoomView } from "@/types/assignment-room";
import { RoomBoard } from "./room-board";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));


const noop = () => {};

function participantView(
  claims: AssignmentRoomView["room"]["claims"],
  status: AssignmentRoomView["room"]["status"] = "open",
  selfParticipantId = "person-a",
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
      selfParticipantId,
      items: [
        {
          id: "beer",
          ordinal: 0,
          revision: 2,
          description: "Cerveja",
          quantityMilliunits: 1_000,
          unitPriceCents: 1_000,
          totalPriceCents: 1_000,
        },
        {
          id: "fries",
          ordinal: 1,
          revision: 1,
          description: "Batata",
          quantityMilliunits: 3_000,
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

function hostView(
  claims: AssignmentRoomView["room"]["claims"],
  status: AssignmentRoomView["room"]["status"] = "open",
): AssignmentRoomView {
  const base = participantView(claims, status);
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
  roomCode: { status: "idle" } as const,
  roomCodeEntryAddress: "localhost:3000/room",
  onRetryRoomCode: noop,
  pendingItemIds: [],
  claimError: null,
  splitError: null,
  onSplit: async () => true,
  onDismissSplitError: noop,
  inviteOpen: false,
  onInviteOpenChange: noop,
  inviteError: null,
  rotatingInvite: false,
  onClaim: async () => true,
  onRotateInvite: noop,
  onRemoveParticipant: noop,
  onClose: noop,
  onCancel: noop,
  onCreateBill: noop,
};

function rowIn(scope: HTMLElement, itemId: string): HTMLElement {
  const row = scope.querySelector<HTMLElement>(`li[data-item-id="${itemId}"]`);
  if (!row) throw new Error(`row ${itemId} not found`);
  return row;
}

describe("RoomBoard", () => {
  it("undoes a saved claim with the current revision and leaves closed rooms read-only", async () => {
    const user = userEvent.setup();
    const onClaim = vi.fn(async () => true);
    const view = participantView([{ itemId: "beer", participantId: "person-a", ticks: 60_000 }]);
    const { rerender } = render(<RoomBoard view={view} {...boardProps} onClaim={onClaim} />);
    await user.click(screen.getByRole("button", { name: "Desfazer Cerveja" }));
    expect(onClaim).toHaveBeenCalledWith("beer", "person-a", 0, 2);
    rerender(<RoomBoard view={{ ...view, room: { ...view.room, status: "closed" } }} {...boardProps} onClaim={onClaim} />);
    expect(screen.getByRole("button", { name: "Desfazer Cerveja" })).toBeDisabled();
    expect(within(screen.getByRole("region", { name: "Minha parte" })).getByRole("button", { name: "Escolher quantidade de Cerveja" })).toBeDisabled();
  });

  it("hides guest money when the projection rejects overlapping claims", () => {
    render(<RoomBoard view={participantView([
      { itemId: "beer", participantId: "person-a", ticks: 120_000 },
      { itemId: "beer", participantId: "person-b", ticks: 120_000 },
    ])} {...boardProps} />);
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
  });
  it("keeps a partially owned line in both personal and available sections", () => {
    render(
      <RoomBoard
        view={participantView([{ itemId: "beer", participantId: "person-a", ticks: 60_000 }])}
        {...boardProps}
      />,
    );

    const available = screen.getByRole("region", { name: "Ainda sem dono" });
    const mine = screen.getByRole("region", { name: "Minha parte" });
    expect(rowIn(available, "beer")).toHaveTextContent("Falta metade");
    expect(rowIn(mine, "beer")).toHaveTextContent("metade");
  });

  it("shows the remaining half to another participant and the personal empty copy", () => {
    const first = render(
      <RoomBoard
        view={participantView([{ itemId: "beer", participantId: "person-a", ticks: 60_000 }])}
        {...boardProps}
      />,
    );
    expect(rowIn(first.getByRole("region", { name: "Ainda sem dono" }), "beer")).toHaveTextContent(
      "Falta metade",
    );
    first.unmount();

    render(
      <RoomBoard
        view={participantView(
          [{ itemId: "beer", participantId: "person-a", ticks: 60_000 }],
          "open",
          "person-b",
        )}
        {...boardProps}
      />,
    );
    expect(rowIn(screen.getByRole("region", { name: "Ainda sem dono" }), "beer")).toHaveTextContent(
      "Falta metade",
    );
    expect(screen.getByRole("region", { name: "Minha parte" }).querySelector("li[data-item-id]")).toBeNull();
  });

  it("keeps an exhausted line in the host overview and gates close on completeness", () => {
    render(
      <RoomBoard
        view={hostView([{ itemId: "beer", participantId: "person-a", ticks: 120_000 }])}
        {...boardProps}
      />,
    );

    const items = screen.getByRole("region", { name: "Itens" });
    expect(rowIn(items, "beer")).toBeInTheDocument();
    expect(rowIn(items, "fries")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Encerrar sala/ })).toBeDisabled();
  });

  it("opens one shared editor without changing ownership and saves through the Promise", async () => {
    const user = userEvent.setup();
    const onClaim = vi.fn<(itemId: string, participantId: string, ticks: number) => Promise<boolean>>(
      async () => true,
    );
    const { rerender } = render(
      <RoomBoard
        view={participantView([{ itemId: "beer", participantId: "person-a", ticks: 60_000 }])}
        {...boardProps}
        onClaim={onClaim}
      />,
    );

    const available = screen.getByRole("region", { name: "Ainda sem dono" });
    const mine = screen.getByRole("region", { name: "Minha parte" });
    await user.click(screen.getByRole("button", { name: "Escolher quantidade de Batata" }));
    const dialog = screen.getByRole("dialog", { name: "Batata" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    expect(rowIn(available, "beer")).toHaveTextContent("Falta metade");
    expect(rowIn(mine, "beer")).toHaveTextContent("metade");

    await user.click(within(dialog).getByRole("button", { name: "1" }));
    await user.click(within(dialog).getByRole("button", { name: /^Peguei / }));
    expect(onClaim).toHaveBeenCalledWith("fries", "person-a", 120_000, 1);

    rerender(
      <RoomBoard
        view={participantView([{ itemId: "beer", participantId: "person-a", ticks: 120_000 }])}
        {...boardProps}
        onClaim={onClaim}
      />,
    );
    expect(
      rowIn(screen.getByRole("region", { name: "Minha parte" }), "beer"),
    ).toHaveTextContent("inteira");
  });

  it("shows a rejected claim's reason and ignores another line's error", async () => {
    const user = userEvent.setup();
    const view = participantView([
      { itemId: "beer", participantId: "person-a", ticks: 60_000 },
    ]);
    const { rerender } = render(
      <RoomBoard
        view={view}
        {...boardProps}
        claimError={{
          itemId: "fries",
          participantId: "person-a",
          message: "Erro em outra linha.",
        }}
      />,
    );

    const available = screen.getByRole("region", { name: "Ainda sem dono" });
    await user.click(
      within(rowIn(available, "beer")).getByRole("button", {
        name: "Escolher quantidade de Cerveja",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Cerveja" });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

    rerender(
      <RoomBoard
        view={view}
        {...boardProps}
        onClaim={async () => false}
        claimError={{
          itemId: "beer",
          participantId: "person-a",
          message: "Outra pessoa ficou com a última unidade.",
        }}
      />,
    );
    expect(
      within(screen.getByRole("dialog", { name: "Cerveja" })).getByRole("alert"),
    ).toHaveTextContent("Outra pessoa ficou com a última unidade.");
  });

  it("renders the host invitation action only on an open host room", () => {
    const { rerender } = render(<RoomBoard view={hostView([])} {...boardProps} />);
    expect(screen.getByRole("button", { name: "Convidar" })).toBeInTheDocument();

    rerender(<RoomBoard view={hostView([])} {...boardProps} inviteOpen />);
    expect(screen.getByRole("dialog", { name: "Sala de itens" })).toBeInTheDocument();

    rerender(<RoomBoard view={participantView([])} {...boardProps} inviteOpen />);
    expect(screen.queryByRole("button", { name: "Convidar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Sala de itens" })).not.toBeInTheDocument();

    rerender(<RoomBoard view={hostView([], "closed")} {...boardProps} inviteOpen />);
    expect(screen.queryByRole("button", { name: "Convidar" })).not.toBeInTheDocument();
  });

  it("counts the roster and lists every host item in ordinal order", () => {
    const first = render(<RoomBoard view={participantView([])} {...boardProps} />);
    expect(first.getByText("2 pessoas na sala")).toBeInTheDocument();
    expect(first.getByRole("listitem", { name: "Bia" })).toBeInTheDocument();
    expect(first.getByRole("listitem", { name: "Caio" })).toBeInTheDocument();
    first.unmount();

    render(
      <RoomBoard
        view={hostView([{ itemId: "fries", participantId: "person-b", ticks: 360_000 }])}
        {...boardProps}
      />,
    );
    const items = screen.getByRole("region", { name: "Itens" });
    const itemIds = [...items.querySelectorAll("li[data-item-id]")].map((row) =>
      row.getAttribute("data-item-id"),
    );
    expect(itemIds).toEqual(["beer", "fries"]);
  });

  it("shows the zero-item copy and keeps an empty room incomplete", () => {
    const view = hostView([]);
    render(
      <RoomBoard
        view={{ ...view, room: { ...view.room, items: [] } }}
        {...boardProps}
      />,
    );

    expect(screen.getByRole("button", { name: /^Encerrar sala/ })).toBeDisabled();
  });

  it("shows closed and terminal guest states without host actions", () => {
    const { rerender } = render(
      <RoomBoard view={participantView([], "closed")} {...boardProps} />,
    );
    expect(screen.getByText("Aguardando confirmação")).toBeInTheDocument();
    expect(screen.queryByText("Controle da sala")).not.toBeInTheDocument();

    rerender(<RoomBoard view={participantView([], "finalized")} {...boardProps} />);
    expect(screen.getByText("Conta registrada")).toBeInTheDocument();
  });
  it("offers a fresh bill after cancellation", async () => {
    const user = userEvent.setup();
    const onCreateBill = vi.fn();
    render(
      <RoomBoard
        view={hostView([], "cancelled")}
        {...boardProps}
        onCreateBill={onCreateBill}
      />,
    );

    expect(screen.getByRole("heading", { name: "Sala cancelada" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Criar outra sala" }));
    expect(onCreateBill).toHaveBeenCalledOnce();
  });
  it("offers a host closed-room path back to the review", async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    render(
      <RoomBoard
        view={hostView([], "closed")}
        {...boardProps}
        onReview={onReview}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Voltar à revisão" }));

    expect(onReview).toHaveBeenCalledOnce();
  });

  it("expands a host row and saves its split with the item revision", async () => {
    const user = userEvent.setup();
    const onSplit = vi.fn(async () => true);
    render(<RoomBoard view={hostView([])} {...boardProps} onSplit={onSplit} />);
    await user.click(screen.getByRole("button", { name: "Cerveja" }));
    const editor = screen.getByRole("form", { name: "Dividir Cerveja" });
    await user.click(within(editor).getByRole("button", { name: "Todos" }));
    await user.click(within(editor).getByRole("button", { name: "Salvar divisão" }));
    expect(onSplit).toHaveBeenCalledWith("beer", [
      { participantId: "person-a", ticks: 60_000 },
      { participantId: "person-b", ticks: 60_000 },
    ], 2);
  });

  it("shows a split error only inside its item's editor", async () => {
    const user = userEvent.setup();
    const view = hostView([]);
    const { rerender } = render(<RoomBoard view={view} {...boardProps}
      splitError={{ itemId: "fries", message: "Não foi possível salvar." }} />);
    await user.click(screen.getByRole("button", { name: "Cerveja" }));
    const editor = screen.getByRole("form", { name: "Dividir Cerveja" });
    expect(within(editor).queryByRole("alert")).not.toBeInTheDocument();
    rerender(<RoomBoard view={view} {...boardProps}
      splitError={{ itemId: "beer", message: "Não foi possível salvar." }} />);
    expect(within(editor).getByRole("alert")).toHaveTextContent("Não foi possível salvar.");
  });

  it("drops an item's split error when its row collapses from the header", async () => {
    const user = userEvent.setup();
    const onDismissSplitError = vi.fn();
    render(<RoomBoard view={hostView([])} {...boardProps} onDismissSplitError={onDismissSplitError}
      splitError={{ itemId: "beer", message: "Não foi possível salvar." }} />);
    await user.click(screen.getByRole("button", { name: "Cerveja" }));
    await user.click(screen.getByRole("button", { name: "Cerveja" }));
    expect(screen.queryByRole("form", { name: "Dividir Cerveja" })).not.toBeInTheDocument();
    expect(onDismissSplitError).toHaveBeenCalledOnce();
  });

  it("projects money by ownership and excludes removed participants from the host roster", async () => {
    const user = userEvent.setup();
    const onRemoveParticipant = vi.fn();
    const view = hostView([{ itemId: "beer", participantId: "person-b", ticks: 60_000 }]);
    const { rerender } = render(<RoomBoard view={view} {...boardProps} onRemoveParticipant={onRemoveParticipant} />);
    const progress = screen.getByRole("progressbar", { name: "Valor com dono" });
    expect(progress).toHaveAttribute("aria-valuenow", "500");
    expect(progress).toHaveAttribute("aria-valuemax", "4000");
    await user.click(within(screen.getByRole("region", { name: "Na sala" })).getByRole("button", { name: "Caio" }));
    await user.click(screen.getByRole("button", { name: /Remover · libera/ }));
    expect(onRemoveParticipant).toHaveBeenCalledWith("person-b");
    rerender(<RoomBoard view={{ ...view, room: { ...view.room, participants: view.room.participants.map((person) => person.id === "person-b" ? { ...person, removed: true } : person) } }} {...boardProps} />);
    expect(within(screen.getByRole("region", { name: "Na sala" })).queryByRole("listitem", { name: "Caio" })).not.toBeInTheDocument();
    expect(progress).toHaveAttribute("aria-valuenow", "0");
  });
});
