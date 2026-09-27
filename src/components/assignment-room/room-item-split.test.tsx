import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoomItemSplit, type RoomItemSplitProps } from "./room-item-split";
import type { AssignmentRoomClaim } from "@/types/assignment-room";

const participants = ["Ana", "Bia", "Caio", "Duda", "Eva", "Fábio", "Gui"].map((displayName, ordinal) => ({
  id: `person-${ordinal}`, ordinal, displayName, avatarUrl: null, isGuest: true, removed: false,
}));
const item = {
  id: "item", ordinal: 0, revision: 4, description: "Petisco", quantityMilliunits: 1_000,
  unitPriceCents: 700, totalPriceCents: 700,
};
function claim(index: number, ticks: number): AssignmentRoomClaim {
  return { itemId: item.id, participantId: participants[index].id, ticks };
}
function props(overrides: Partial<RoomItemSplitProps> = {}): RoomItemSplitProps {
  return {
    item, participants, claims: [], selfParticipantId: participants[0].id,
    labels: new Map(participants.map((person) => [person.id, person.displayName])),
    focusParticipantId: null, pending: false, disabled: false, error: null,
    previewCents: () => new Map(), onSave: vi.fn(async () => true),
    onClose: vi.fn(), onDirtyChange: vi.fn(), onDismissError: vi.fn(), ...overrides,
  };
}

describe("RoomItemSplit", () => {
  it("splits Todos in participant order with exact remainder ticks and the base revision", async () => {
    const user = userEvent.setup();
    const input = props();
    render(<RoomItemSplit {...input} />);
    await user.click(screen.getByRole("button", { name: "Todos" }));
    await user.click(screen.getByRole("button", { name: "Salvar divisão" }));
    expect(input.onSave).toHaveBeenCalledWith(participants.map((person, index) => ({
      participantId: person.id, ticks: index === 6 ? 17_142 : 17_143,
    })), 4);
  });

  it("re-splits Igual among remaining owners and releases the deselected owner", async () => {
    const user = userEvent.setup();
    const input = props({ claims: [claim(0, 40_000), claim(1, 40_000), claim(2, 40_000)] });
    render(<RoomItemSplit {...input} />);
    await user.click(screen.getByRole("button", { name: "Bia" }));
    await user.click(screen.getByRole("button", { name: "Salvar divisão" }));
    expect(input.onSave).toHaveBeenCalledWith([
      { participantId: "person-0", ticks: 60_000 },
      { participantId: "person-2", ticks: 60_000 },
      { participantId: "person-1", ticks: 0 },
    ], 4);
  });

  it("changes only the adjusted person's share", async () => {
    const user = userEvent.setup();
    const input = props({ claims: [claim(0, 60_000), claim(1, 60_000)] });
    render(<RoomItemSplit {...input} />);
    await user.click(screen.getByRole("radio", { name: "Ajustar" }));
    fireEvent.change(screen.getByRole("slider", { name: "Parte de Ana" }), { target: { value: "25" } });
    expect(screen.getByRole("slider", { name: "Parte de Bia" })).toHaveValue("50");
    await user.click(screen.getByRole("button", { name: "Salvar divisão" }));
    expect(input.onSave).toHaveBeenCalledWith([{ participantId: "person-0", ticks: 30_000 }], 4);
  });

  it("fills a weighed line exactly with 33, 33 and 34 percent", async () => {
    const user = userEvent.setup();
    const input = props({ item: { ...item, quantityMilliunits: 1_237 }, participants: participants.slice(0, 3) });
    render(<RoomItemSplit {...input} />);
    await user.click(screen.getByRole("radio", { name: "Ajustar" }));
    await user.click(screen.getByRole("button", { name: "Todos" }));
    for (const [name, value] of [["Ana", "33"], ["Bia", "33"], ["Caio", "34"]]) {
      fireEvent.change(screen.getByRole("slider", { name: `Parte de ${name}` }), { target: { value } });
    }
    await user.click(screen.getByRole("button", { name: "Salvar divisão" }));
    expect(input.onSave).toHaveBeenCalledWith([
      { participantId: "person-0", ticks: 48_985 },
      { participantId: "person-1", ticks: 48_985 },
      { participantId: "person-2", ticks: 50_470 },
    ], 4);
  });

  it("cannot save unchanged or over-capacity drafts", async () => {
    const user = userEvent.setup();
    const input = props({ claims: [claim(0, 60_000), claim(1, 60_000)] });
    render(<RoomItemSplit {...input} />);
    const save = screen.getByRole("button", { name: "Salvar divisão" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Ajustar" }));
    fireEvent.change(screen.getByRole("slider", { name: "Parte de Ana" }), { target: { value: "75" } });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(input.onSave).not.toHaveBeenCalled();
  });

  it("silently re-seeds an untouched draft on a new revision", async () => {
    const user = userEvent.setup();
    const input = props();
    const { rerender } = render(<RoomItemSplit {...input} />);
    rerender(<RoomItemSplit {...input} item={{ ...item, revision: 5 }} claims={[claim(1, 120_000)]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bia" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Limpar" }));
    await user.click(screen.getByRole("button", { name: "Liberar item" }));
    expect(input.onSave).toHaveBeenCalledWith([{ participantId: "person-1", ticks: 0 }], 5);
  });

  it("blocks a touched stale draft until Atualizar re-seeds it", async () => {
    const user = userEvent.setup();
    const input = props();
    const { rerender } = render(<RoomItemSplit {...input} />);
    await user.click(screen.getByRole("button", { name: "Ana" }));
    rerender(<RoomItemSplit {...input} item={{ ...item, revision: 5 }} claims={[claim(1, 120_000)]} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar divisão" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ana" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Bia" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Limpar" }));
    await user.click(screen.getByRole("button", { name: "Liberar item" }));
    expect(input.onSave).toHaveBeenCalledWith([{ participantId: "person-1", ticks: 0 }], 5);
  });

  it("clears every saved owner with explicit zero shares", async () => {
    const user = userEvent.setup();
    const input = props({ claims: [claim(0, 60_000), claim(1, 60_000)] });
    render(<RoomItemSplit {...input} />);
    await user.click(screen.getByRole("button", { name: "Limpar" }));
    await user.click(screen.getByRole("button", { name: "Liberar item" }));
    expect(input.onSave).toHaveBeenCalledWith([
      { participantId: "person-0", ticks: 0 }, { participantId: "person-1", ticks: 0 },
    ], 4);
  });

  it("never submits a claim belonging to someone absent from participants", async () => {
    const user = userEvent.setup();
    const input = props({ participants: participants.slice(0, 2), claims: [claim(0, 60_000), claim(6, 60_000)] });
    render(<RoomItemSplit {...input} />);
    await user.click(screen.getByRole("button", { name: "Limpar" }));
    await user.click(screen.getByRole("button", { name: "Liberar item" }));
    expect(input.onSave).toHaveBeenCalledWith([{ participantId: "person-0", ticks: 0 }], 4);
  });

  it("follows the remaining shares when someone leaves while the editor is open", async () => {
    const user = userEvent.setup();
    const input = props({ claims: [claim(0, 60_000), claim(1, 60_000)] });
    const { rerender } = render(<RoomItemSplit {...input} />);
    rerender(<RoomItemSplit {...input} participants={[participants[0], ...participants.slice(2)]} claims={[claim(0, 60_000)]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Falta metade");
    await user.click(screen.getByRole("radio", { name: "Ajustar" }));
    fireEvent.change(screen.getByRole("slider", { name: "Parte de Ana" }), { target: { value: "100" } });
    await user.click(screen.getByRole("button", { name: "Salvar divisão" }));
    expect(input.onSave).toHaveBeenCalledWith([{ participantId: "person-0", ticks: 120_000 }], 4);
  });

  it("keeps whole units when paging a multi-unit slider after an uneven split", async () => {
    const user = userEvent.setup();
    const chopp = { ...item, quantityMilliunits: 2_000, unitPriceCents: 350 };
    render(<RoomItemSplit {...props({ item: chopp, participants: participants.slice(0, 3) })} />);
    await user.click(screen.getByRole("button", { name: "Todos" }));
    await user.click(screen.getByRole("radio", { name: "Ajustar" }));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Parte de Ana" }), { key: "PageUp" });
    expect(screen.getByRole("slider", { name: "Parte de Ana" })).toHaveValue("2");
    expect(screen.getByRole("status")).toHaveTextContent("Passou");
  });

  it("only offers to release an item that someone owns", () => {
    render(<RoomItemSplit {...props()} />);
    expect(screen.queryByRole("button", { name: "Liberar item" })).not.toBeInTheDocument();
  });
});
