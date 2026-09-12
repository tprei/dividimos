import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "@/stores/app-store";
import { useBillStore } from "@/stores/bill-store";
import type { GroupSnapshot } from "@/types/ledger";
import { ItemDivisionEditor, type ItemDivisionParticipant } from "./item-division-editor";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

const PEOPLE: ItemDivisionParticipant[] = [
  { id: "u1", name: "Ana", handle: "ana", avatarUrl: null, isGuest: false },
  { id: "u2", name: "Bruno", handle: "bruno", avatarUrl: null, isGuest: false },
  { id: "g1", name: "Maria", handle: null, avatarUrl: null, isGuest: true },
];

function renderEditor(value: React.ComponentProps<typeof ItemDivisionEditor>["value"] = null) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <ItemDivisionEditor
      itemId="i1"
      itemName="Picanha"
      itemCents={12900}
      participants={PEOPLE}
      value={value}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { onSave, onClose };
}

describe("ItemDivisionEditor", () => {
  it("does not save until somebody is selected, then saves equal shares", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Selecione quem divide este item.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onSave).toHaveBeenCalledWith({
      mode: "equal",
      shares: [
        { participantId: "u1", cents: 4300 },
        { participantId: "u2", cents: 4300 },
        { participantId: "g1", cents: 4300 },
      ],
    });
  });

  it("commits the division after the debounce without any button press", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    render(
      <ItemDivisionEditor
        itemId="i1"
        itemName="Picanha"
        itemCents={12900}
        participants={PEOPLE}
        value={null}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Incluir Ana (@ana) em Picanha"));
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("seeds percent inputs evenly and holds the commit until they close 100%", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByLabelText("Incluir Ana (@ana) em Picanha"));
    fireEvent.click(screen.getByLabelText("Incluir Bruno (@bruno) em Picanha"));
    fireEvent.click(screen.getByRole("radio", { name: "Percentual" }));

    const ana = screen.getByLabelText("Percentual de Ana (@ana) em Picanha") as HTMLInputElement;
    const bruno = screen.getByLabelText("Percentual de Bruno (@bruno) em Picanha") as HTMLInputElement;
    expect(ana.value).toBe("50,00");
    expect(bruno.value).toBe("50,00");

    fireEvent.change(ana, { target: { value: "49" } });
    expect(screen.getByText("Faltam 1,00% para fechar 100%.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(bruno, { target: { value: "51" } });
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onSave).toHaveBeenCalledWith({
      mode: "percent",
      shares: [
        { participantId: "u1", cents: 6321, basisPoints: 4900 },
        { participantId: "u2", cents: 6579, basisPoints: 5100 },
      ],
    });
  });

  it("restores a saved fixed division when reopened", () => {
    const { onSave } = renderEditor({
      mode: "fixed",
      shares: [
        { participantId: "u1", cents: 10000 },
        { participantId: "g1", cents: 2900 },
      ],
    });
    expect(screen.getByRole("radio", { name: "Fixo" })).toHaveAttribute("aria-checked", "true");
    expect((screen.getByLabelText("Valor fixo de Ana (@ana) em Picanha") as HTMLInputElement).value).toBe("100,00");
    expect((screen.getByLabelText("Valor fixo de Bruno (@bruno) em Picanha") as HTMLInputElement).value).toBe("0,00");
    expect((screen.getByLabelText("Valor fixo de Maria em Picanha") as HTMLInputElement).value).toBe("29,00");
    expect(screen.getByText("Salvo automaticamente")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("re-includes a participant when their percent slider leaves zero", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Percentual" }));

    const mariaInput = screen.getByLabelText("Percentual de Maria em Picanha") as HTMLInputElement;
    expect(mariaInput.value).toBe("33,00");
    fireEvent.change(mariaInput, { target: { value: "0" } });

    const mariaSlider = screen.getByRole("slider", { name: "Percentual deslizante de Maria em Picanha" });
    expect(mariaSlider).toHaveValue("0");
    fireEvent.change(mariaSlider, { target: { value: "30" } });

    const brunoInput = screen.getByLabelText("Percentual de Bruno (@bruno) em Picanha") as HTMLInputElement;
    fireEvent.change(brunoInput, { target: { value: "36" } });

    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onSave).toHaveBeenCalledWith({
      mode: "percent",
      shares: [
        { participantId: "u1", cents: 4386, basisPoints: 3400 },
        { participantId: "u2", cents: 4644, basisPoints: 3600 },
        { participantId: "g1", cents: 3870, basisPoints: 3000 },
      ],
    });
  });

  it("drops a participant when their fixed value is zeroed", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Fixo" }));

    const brunoInput = screen.getByLabelText("Valor fixo de Bruno (@bruno) em Picanha") as HTMLInputElement;
    expect(brunoInput.value).toBe("43,00");
    fireEvent.change(brunoInput, { target: { value: "0" } });

    const anaInput = screen.getByLabelText("Valor fixo de Ana (@ana) em Picanha") as HTMLInputElement;
    fireEvent.change(anaInput, { target: { value: "64,50" } });
    const mariaInput = screen.getByLabelText("Valor fixo de Maria em Picanha") as HTMLInputElement;
    fireEvent.change(mariaInput, { target: { value: "64,50" } });

    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onSave).toHaveBeenCalledWith({
      mode: "fixed",
      shares: [
        { participantId: "u1", cents: 6450 },
        { participantId: "g1", cents: 6450 },
      ],
    });
  });

  it("zeroes the fixed value texts when clearing the selection", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Fixo" }));
    fireEvent.click(screen.getByRole("button", { name: "Nenhum" }));

    expect((screen.getByLabelText("Valor fixo de Ana (@ana) em Picanha") as HTMLInputElement).value).toBe("0,00");
    expect((screen.getByLabelText("Valor fixo de Bruno (@bruno) em Picanha") as HTMLInputElement).value).toBe("0,00");
    expect((screen.getByLabelText("Valor fixo de Maria em Picanha") as HTMLInputElement).value).toBe("0,00");
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps percent slider drags and typed input on the same state", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByLabelText("Incluir Ana (@ana) em Picanha"));
    fireEvent.click(screen.getByLabelText("Incluir Bruno (@bruno) em Picanha"));
    fireEvent.click(screen.getByRole("radio", { name: "Percentual" }));

    const anaInput = screen.getByLabelText("Percentual de Ana (@ana) em Picanha") as HTMLInputElement;
    const anaSlider = screen.getByRole("slider", { name: "Percentual deslizante de Ana (@ana) em Picanha" });
    fireEvent.change(anaSlider, { target: { value: "40.6" } });
    expect(anaInput.value).toBe("41,00");

    fireEvent.change(anaInput, { target: { value: "33" } });
    expect(anaSlider).toHaveValue("33");

    const brunoSlider = screen.getByRole("slider", { name: "Percentual deslizante de Bruno (@bruno) em Picanha" });
    fireEvent.change(brunoSlider, { target: { value: "67" } });
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onSave).toHaveBeenCalledWith({
      mode: "percent",
      shares: [
        { participantId: "u1", cents: 4257, basisPoints: 3300 },
        { participantId: "u2", cents: 8643, basisPoints: 6700 },
      ],
    });
  });

  it("snaps a percent slider release to the nearest multiple of 5 within the window", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByLabelText("Incluir Ana (@ana) em Picanha"));
    fireEvent.click(screen.getByLabelText("Incluir Bruno (@bruno) em Picanha"));
    fireEvent.click(screen.getByRole("radio", { name: "Percentual" }));

    const anaSlider = screen.getByRole("slider", { name: "Percentual deslizante de Ana (@ana) em Picanha" });
    fireEvent.change(anaSlider, { target: { value: "48" } });
    fireEvent.pointerUp(anaSlider);

    expect(anaSlider).toHaveValue("50");
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onSave).toHaveBeenCalledWith({
      mode: "percent",
      shares: [
        { participantId: "u1", cents: 6450, basisPoints: 5000 },
        { participantId: "u2", cents: 6450, basisPoints: 5000 },
      ],
    });
  });

  it("lets a zeroed participant be dragged back in once the others free room", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Fixo" }));

    const brunoInput = screen.getByLabelText("Valor fixo de Bruno (@bruno) em Picanha") as HTMLInputElement;
    fireEvent.change(brunoInput, { target: { value: "0" } });
    const anaInput = screen.getByLabelText("Valor fixo de Ana (@ana) em Picanha") as HTMLInputElement;
    fireEvent.change(anaInput, { target: { value: "64,50" } });
    const mariaInput = screen.getByLabelText("Valor fixo de Maria em Picanha") as HTMLInputElement;
    fireEvent.change(mariaInput, { target: { value: "64,50" } });

    const brunoSlider = screen.getByRole("slider", {
      name: "Valor deslizante de Bruno (@bruno) em Picanha",
    });
    fireEvent.change(brunoSlider, { target: { value: "4300" } });
    fireEvent.change(anaInput, { target: { value: "43,00" } });
    fireEvent.change(mariaInput, { target: { value: "43,00" } });

    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onSave).toHaveBeenCalledWith({
      mode: "fixed",
      shares: [
        { participantId: "u1", cents: 4300 },
        { participantId: "u2", cents: 4300 },
        { participantId: "g1", cents: 4300 },
      ],
    });
  });

  it("keeps a typed value that does not parse yet instead of reverting it", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Fixo" }));

    const brunoInput = screen.getByLabelText("Valor fixo de Bruno (@bruno) em Picanha") as HTMLInputElement;
    fireEvent.change(brunoInput, { target: { value: "0" } });
    fireEvent.change(brunoInput, { target: { value: "0,005" } });

    expect(brunoInput.value).toBe("0,005");
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("ItemDivisionEditor pending invite", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    useBillStore.getState().reset();
  });

  it("marks a participant whose invite is still pending", () => {
    useBillStore.getState().createExpense("Churrasco", "itemized", undefined, "g1");
    const snapshot: GroupSnapshot = {
      group: {
        id: "g1",
        kind: "group",
        name: "Churrasco",
        creatorId: "u1",
        dmUserA: null,
        dmUserB: null,
        ledgerVersion: 1,
        createdAt: "2026-09-01T00:00:00Z",
      },
      members: [
        {
          groupId: "g1",
          userId: "u2",
          status: "invited",
          invitedBy: "u1",
          acceptedAt: null,
          user: { id: "u2", handle: "bruno", name: "Bruno", avatarUrl: null },
        },
      ],
      balances: [],
      guests: [],
      settlements: [],
      recentExpenses: [],
      expenseCount: 0,
      lastEventId: 0,
      unreadCount: 0,
      lastMessage: null,
      lastActivityAt: "2026-09-01T00:00:00Z",
      pairwiseEdges: [],
    };
    useAppStore.setState({ groups: { g1: snapshot } });

    renderEditor();

    expect(screen.getByText("Convite pendente")).toBeInTheDocument();
  });
});
