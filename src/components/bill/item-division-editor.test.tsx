import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
  { id: "u1", name: "Ana", avatarUrl: null, isGuest: false },
  { id: "u2", name: "Bruno", avatarUrl: null, isGuest: false },
  { id: "g1", name: "Maria", avatarUrl: null, isGuest: true },
];

function renderEditor(value: React.ComponentProps<typeof ItemDivisionEditor>["value"] = null) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <ItemDivisionEditor
      itemId="i1"
      itemName="Picanha"
      itemCents={12900}
      participants={PEOPLE}
      value={value}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );
  return { onSave, onCancel };
}

describe("ItemDivisionEditor", () => {
  it("keeps save disabled until somebody is selected, then saves equal shares", () => {
    const { onSave } = renderEditor();
    const save = screen.getByRole("button", { name: "Salvar" });
    expect(save).toBeDisabled();
    expect(screen.getByText("Selecione quem divide este item.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({
      mode: "equal",
      shares: [
        { participantId: "u1", cents: 4300 },
        { participantId: "u2", cents: 4300 },
        { participantId: "g1", cents: 4300 },
      ],
    });
  });

  it("seeds percent inputs evenly and blocks save until they close 100%", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByLabelText("Incluir Ana em Picanha"));
    fireEvent.click(screen.getByLabelText("Incluir Bruno em Picanha"));
    fireEvent.click(screen.getByRole("radio", { name: "Percentual" }));

    const ana = screen.getByLabelText("Percentual de Ana em Picanha") as HTMLInputElement;
    const bruno = screen.getByLabelText("Percentual de Bruno em Picanha") as HTMLInputElement;
    expect(ana.value).toBe("50,00");
    expect(bruno.value).toBe("50,00");

    fireEvent.change(ana, { target: { value: "49" } });
    expect(screen.getByText("Faltam 1,00% para fechar 100%.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();

    fireEvent.change(bruno, { target: { value: "51" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave).toHaveBeenCalledWith({
      mode: "percent",
      shares: [
        { participantId: "u1", cents: 6321, basisPoints: 4900 },
        { participantId: "u2", cents: 6579, basisPoints: 5100 },
      ],
    });
  });

  it("restores a saved fixed division when reopened", () => {
    renderEditor({
      mode: "fixed",
      shares: [
        { participantId: "u1", cents: 10000 },
        { participantId: "g1", cents: 2900 },
      ],
    });
    expect(screen.getByRole("radio", { name: "Fixo" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Incluir Ana em Picanha")).toBeChecked();
    expect(screen.getByLabelText("Incluir Bruno em Picanha")).not.toBeChecked();
    expect(screen.getByLabelText("Incluir Maria em Picanha")).toBeChecked();
    expect((screen.getByLabelText("Valor fixo de Ana em Picanha") as HTMLInputElement).value).toBe("100,00");
    expect((screen.getByLabelText("Valor fixo de Maria em Picanha") as HTMLInputElement).value).toBe("29,00");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  it("calls onCancel without saving", () => {
    const { onSave, onCancel } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps percent slider drags and typed input on the same state", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByLabelText("Incluir Ana em Picanha"));
    fireEvent.click(screen.getByLabelText("Incluir Bruno em Picanha"));
    fireEvent.click(screen.getByRole("radio", { name: "Percentual" }));

    const anaInput = screen.getByLabelText("Percentual de Ana em Picanha") as HTMLInputElement;
    const anaSlider = screen.getByRole("slider", { name: "Percentual deslizante de Ana em Picanha" });
    fireEvent.change(anaSlider, { target: { value: "40.6" } });
    expect(anaInput.value).toBe("41,00");

    fireEvent.change(anaInput, { target: { value: "33" } });
    expect(anaSlider).toHaveValue("33");

    const brunoSlider = screen.getByRole("slider", { name: "Percentual deslizante de Bruno em Picanha" });
    fireEvent.change(brunoSlider, { target: { value: "67" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
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
    fireEvent.click(screen.getByLabelText("Incluir Ana em Picanha"));
    fireEvent.click(screen.getByLabelText("Incluir Bruno em Picanha"));
    fireEvent.click(screen.getByRole("radio", { name: "Percentual" }));

    const anaSlider = screen.getByRole("slider", { name: "Percentual deslizante de Ana em Picanha" });
    fireEvent.change(anaSlider, { target: { value: "48" } });
    fireEvent.pointerUp(anaSlider);

    expect(anaSlider).toHaveValue("50");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave).toHaveBeenCalledWith({
      mode: "percent",
      shares: [
        { participantId: "u1", cents: 6450, basisPoints: 5000 },
        { participantId: "u2", cents: 6450, basisPoints: 5000 },
      ],
    });
  });

  it("bounds the fixed slider by the amount still unassigned for that person", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    fireEvent.click(screen.getByRole("radio", { name: "Fixo" }));
    const anaSlider = screen.getByRole("slider", { name: "Valor deslizante de Ana em Picanha" });
    expect(anaSlider).toHaveAttribute("max", "4300");
    fireEvent.change(anaSlider, { target: { value: "999999" } });

    expect(anaSlider).toHaveValue("4300");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave).toHaveBeenCalledWith({
      mode: "fixed",
      shares: [
        { participantId: "u1", cents: 4300 },
        { participantId: "u2", cents: 4300 },
        { participantId: "g1", cents: 4300 },
      ],
    });
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
