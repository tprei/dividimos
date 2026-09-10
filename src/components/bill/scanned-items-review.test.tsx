import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { todayIsoDate } from "@/app/app/bill/new/use-wizard-submit";
import type { ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import { ScannedItemsReview } from "./scanned-items-review";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() }),
}));

const participants: ItemDivisionParticipant[] = [
  { id: "user-alice", name: "Alice", avatarUrl: null, isGuest: false },
  { id: "user-bob", name: "Bob", avatarUrl: null, isGuest: false },
];

const makeResult = (overrides?: Partial<ReceiptOcrResult>): ReceiptOcrResult => ({
  merchant: "Bar do Zé",
  items: [
    {
      description: "Cerveja Brahma 600ml",
      quantity: 2,
      unitPriceCents: 1200,
      totalCents: 2400,
    },
    {
      description: "Picanha 400g",
      quantity: 1,
      unitPriceCents: 4500,
      totalCents: 4500,
    },
  ],
  serviceFeeBasisPoints: 1000,
  fixedFeesCents: 0,
  totalCents: 6900,
  ...overrides,
});

function renderReview(
  result: ReceiptOcrResult = makeResult(),
  onConfirm = vi.fn(),
  onCancel = vi.fn(),
) {
  render(
    <ScannedItemsReview
      result={result}
      participants={participants}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ScannedItemsReview", () => {
  it("renders the receipt draft and fee-inclusive total", () => {
    renderReview();

    expect(screen.getByRole("heading", { name: "Recibo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome do estabelecimento")).toHaveValue("Bar do Zé");
    const [year, month, day] = todayIsoDate().split("-");
    expect(screen.getByRole("button", { name: "Data do recibo" })).toHaveTextContent(
      `${day}/${month}/${year}`,
    );
    expect(screen.getByDisplayValue("24,00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("45,00")).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*75,90/)).toBeInTheDocument();
  });

  it("calls onCancel from the screen header", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderReview();

    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("updates pending count after saving an inline division", async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByRole("button", { name: "Dividir Cerveja Brahma 600ml" }));
    await user.click(screen.getByLabelText("Incluir Alice em Cerveja Brahma 600ml"));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(screen.getByText("1 pendente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dividir Cerveja Brahma 600ml" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("applies batch assignment only to selected rows", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderReview();

    await user.click(screen.getByLabelText("Selecionar Cerveja Brahma 600ml"));
    await user.click(screen.getByRole("button", { name: "Atribuir · 1" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Atribuir a Alice"));
    await user.click(screen.getByRole("button", { name: "Aplicar em 1 item" }));
    await user.click(screen.getByRole("button", { name: "Limpar" }));
    await user.click(screen.getByRole("button", { name: "Continuar para divisão" }));

    const divisions = onConfirm.mock.calls[0][1] as Record<number, { mode: string; shares: { participantId: string }[] }>;
    expect(divisions[0].mode).toBe("equal");
    expect(divisions[0].shares.map((share) => share.participantId)).toEqual(["user-bob"]);
    expect(divisions[1]).toBeUndefined();
  });

  it("keeps item selection while expanding and collapsing a row", async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByLabelText("Selecionar Cerveja Brahma 600ml"));
    await user.click(screen.getByRole("button", { name: "Dividir Cerveja Brahma 600ml" }));
    expect(screen.getByRole("button", { name: "Atribuir · 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dividir Cerveja Brahma 600ml" }));
    expect(screen.getByRole("button", { name: "Atribuir · 1" })).toBeInTheDocument();
  });

  it("continues with edited items, divisions, and date", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderReview();

    fireEvent.change(screen.getByLabelText("Nome do estabelecimento"), { target: { value: "Mercado" } });
    const nameInput = screen.getByRole("textbox", { name: "Nome de Cerveja Brahma 600ml" });
    fireEvent.change(nameInput, { target: { value: "Cerveja" } });
    const amountInput = screen.getByDisplayValue("24,00");
    fireEvent.change(amountInput, { target: { value: "30,00" } });
    await user.click(screen.getByRole("button", { name: "Data do recibo" }));
    await user.click(screen.getByRole("button", { name: "9 de setembro de 2026" }));
    await user.click(screen.getByLabelText("Selecionar Cerveja"));
    await user.click(screen.getByRole("button", { name: "Atribuir · 1" }));
    await user.click(screen.getByRole("button", { name: "Aplicar em 1 item" }));
    await user.click(screen.getByRole("button", { name: "Limpar" }));
    await user.click(screen.getByRole("button", { name: "Continuar para divisão" }));

    expect(onConfirm).toHaveBeenCalledOnce();
    const [draft, divisions, occurredOn] = onConfirm.mock.calls[0] as [
      ReceiptOcrResult,
      Record<number, { mode: string; shares: { participantId: string; cents: number }[] }>,
      string,
    ];
    expect(draft.merchant).toBe("Mercado");
    expect(draft.items[0]).toMatchObject({
      description: "Cerveja",
      totalCents: 3000,
      quantity: 2000,
    });
    expect(draft.totalCents).toBe(8250);
    expect(divisions[0].shares).toHaveLength(2);
    expect(divisions[0].shares.reduce((sum, share) => sum + share.cents, 0)).toBe(3000);
    expect(occurredOn).toBe("2026-09-09");
  });

  it("shows the empty receipt state and disables continue", () => {
    renderReview(makeResult({ items: [], totalCents: 0 }));

    expect(screen.getByText("Nenhum item. Tente escanear novamente ou adicione manualmente.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar para divisão" })).toBeDisabled();
    expect(screen.getByText("0 pendentes")).toBeInTheDocument();
  });
});
