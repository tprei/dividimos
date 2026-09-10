import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ItemDivisionEditor, type ItemDivisionParticipant } from "./item-division-editor";

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
    fireEvent.change(screen.getByLabelText("Modo de divisão de Picanha"), { target: { value: "percent" } });

    const ana = screen.getByLabelText("Percentual de Ana em Picanha") as HTMLInputElement;
    const bruno = screen.getByLabelText("Percentual de Bruno em Picanha") as HTMLInputElement;
    expect(ana.value).toBe("50,00");
    expect(bruno.value).toBe("50,00");

    fireEvent.change(ana, { target: { value: "49,99" } });
    expect(screen.getByText("Faltam 0,01% para fechar 100%.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();

    fireEvent.change(bruno, { target: { value: "50,01" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave).toHaveBeenCalledWith({
      mode: "percent",
      shares: [
        { participantId: "u1", cents: 6449, basisPoints: 4999 },
        { participantId: "u2", cents: 6451, basisPoints: 5001 },
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
    expect((screen.getByLabelText("Modo de divisão de Picanha") as HTMLSelectElement).value).toBe("fixed");
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
});
