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
      onManageParticipants={vi.fn()}
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
    expect(screen.getByText(/R\$\s*24,00/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*45,00/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*69,00/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*75,90/)).toBeInTheDocument();
  });

  it("calls onCancel from the screen header", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderReview();

    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("disables continue with a single participant and enables it once a second is added", () => {
    const onConfirm = vi.fn();
    const result = makeResult();
    const { rerender } = render(
      <ScannedItemsReview
        result={result}
        participants={[participants[0]]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onManageParticipants={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Continuar para divisão" })).toBeDisabled();
    expect(
      screen.getByText("Adicione pelo menos uma pessoa além de você."),
    ).toBeInTheDocument();

    rerender(
      <ScannedItemsReview
        result={result}
        participants={participants}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onManageParticipants={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Continuar para divisão" })).toBeEnabled();
    expect(
      screen.queryByText("Adicione pelo menos uma pessoa além de você."),
    ).not.toBeInTheDocument();
  });

  it("opens only one row panel at a time", async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByRole("button", { name: "Editar Cerveja Brahma 600ml" }));
    expect(screen.getByLabelText("Nome de Cerveja Brahma 600ml")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Editar Picanha 400g" }));
    expect(screen.queryByLabelText("Nome de Cerveja Brahma 600ml")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nome de Picanha 400g")).toBeInTheDocument();
  });

  it("continues with details edited inside the row panel", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderReview();

    fireEvent.change(screen.getByLabelText("Nome do estabelecimento"), {
      target: { value: "Mercado" },
    });
    await user.click(screen.getByRole("button", { name: "Editar Cerveja Brahma 600ml" }));
    fireEvent.change(screen.getByLabelText("Nome de Cerveja Brahma 600ml"), {
      target: { value: "Cerveja" },
    });
    fireEvent.change(screen.getByLabelText("Valor de Cerveja"), { target: { value: "30,00" } });
    await user.click(screen.getByRole("button", { name: "Pronto" }));
    await user.click(screen.getByRole("button", { name: "Data do recibo" }));
    await user.click(screen.getByRole("button", { name: "9 de setembro de 2026" }));
    await user.click(screen.getByRole("button", { name: "Continuar para divisão" }));

    expect(onConfirm).toHaveBeenCalledOnce();
    const [draft, , occurredOn] = onConfirm.mock.calls[0] as [
      ReceiptOcrResult,
      string | null,
      string,
    ];
    expect(draft.merchant).toBe("Mercado");
    expect(draft.items[0]).toMatchObject({
      description: "Cerveja",
      totalCents: 3000,
      quantity: 2000,
    });
    expect(draft.totalCents).toBe(8250);
    expect(occurredOn).toBe("2026-09-09");
  });

  it("blocks continue and names the broken row when a name is cleared", async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByRole("button", { name: "Editar Cerveja Brahma 600ml" }));
    fireEvent.change(screen.getByLabelText("Nome de Cerveja Brahma 600ml"), {
      target: { value: "   " },
    });

    expect(screen.getByRole("button", { name: "Continuar para divisão" })).toBeDisabled();
    expect(screen.getByText("Informe o nome do item.")).toBeInTheDocument();
  });

  it("explains an unsatisfiable amount without opening a panel", () => {
    renderReview(
      makeResult({
        items: [{ description: "Cerveja", quantity: 3, unitPriceCents: 334, totalCents: 1000 }],
        totalCents: 1000,
      }),
    );

    expect(screen.getByText("Valor incompatível com a quantidade.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar para divisão" })).toBeDisabled();
    expect(screen.queryByLabelText("Valor de Cerveja")).not.toBeInTheDocument();
  });

  it("shows the empty receipt state and disables continue", () => {
    renderReview(makeResult({ items: [], totalCents: 0 }));

    expect(
      screen.getByText("Nenhum item. Tente escanear novamente ou adicione manualmente."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar para divisão" })).toBeDisabled();
  });
});
