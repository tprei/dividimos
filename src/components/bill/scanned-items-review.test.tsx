import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  { id: "user-alice", name: "Alice", handle: "alice", avatarUrl: null, isGuest: false },
  { id: "user-bob", name: "Bob", handle: "bob", avatarUrl: null, isGuest: false },
];

const guest: ItemDivisionParticipant = {
  id: "guest-carol",
  name: "Carol Souza",
  handle: null,
  avatarUrl: null,
  isGuest: true,
};

const blockedMessage =
  "Você adicionou pessoas para dividir manualmente. Remova essas pessoas para criar uma sala.";

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
  totalCents: 7590,
  ...overrides,
});

function renderReview(
  result: ReceiptOcrResult = makeResult(),
  onConfirm = vi.fn(),
  onCancel = vi.fn(),
  overrides: {
    participants?: ItemDivisionParticipant[];
    sharePending?: boolean;
    shareError?: string | null;
    inGroup?: boolean;
    inConversation?: boolean;
  } = {},
) {
  const onShare = vi.fn();
  render(
    <ScannedItemsReview
      result={result}
      participants={overrides.participants ?? participants}
      onConfirm={onConfirm}
      onShare={onShare}
      onCancel={onCancel}
      onManageParticipants={vi.fn()}
      sharePending={overrides.sharePending}
      shareError={overrides.shareError}
      inGroup={overrides.inGroup}
      inConversation={overrides.inConversation}
    />,
  );
  return { onConfirm, onCancel, onShare };
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

  it("creates a room when only self is selected and manual splitting waits for people", () => {
    const { onConfirm, onShare } = renderReview(makeResult(), vi.fn(), vi.fn(), {
      participants: [participants[0]],
    });

    const createRoom = screen.getByRole("button", { name: "Criar sala de divisão" });
    expect(createRoom).toBeEnabled();
    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeDisabled();
    expect(
      screen.getByText("Adicione pelo menos uma pessoa para dividir manualmente."),
    ).toBeInTheDocument();
    expect(screen.queryByText(blockedMessage)).not.toBeInTheDocument();

    fireEvent.click(createRoom);
    expect(onShare).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("blocks room creation while a selected account is present", () => {
    renderReview();

    const createRoom = screen.getByRole("button", { name: "Criar sala de divisão" });
    expect(createRoom).toBeDisabled();
    expect(createRoom).toHaveAccessibleDescription(blockedMessage);
    expect(screen.getByText(blockedMessage)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Gerenciar pessoas/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeEnabled();
  });

  it("blocks room creation while a named guest is present", () => {
    renderReview(makeResult(), vi.fn(), vi.fn(), {
      participants: [participants[0], guest],
    });

    expect(screen.getByRole("button", { name: "Criar sala de divisão" })).toBeDisabled();
    expect(screen.getByText(blockedMessage)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeEnabled();
  });

  it("opens a room for a group scan even with every member selected", () => {
    const { onConfirm, onShare } = renderReview(makeResult(), vi.fn(), vi.fn(), {
      inGroup: true,
    });

    const createRoom = screen.getByRole("button", { name: "Criar sala de divisão" });
    expect(createRoom).toBeEnabled();
    expect(screen.queryByText(blockedMessage)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeEnabled();

    fireEvent.click(createRoom);
    expect(onShare).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows the conversation caption when the room targets a DM", () => {
    renderReview(makeResult(), vi.fn(), vi.fn(), {
      inGroup: true,
      inConversation: true,
    });

    expect(
      screen.getByText("A conversa recebe um aviso e cada um escolhe o que consumiu."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("O grupo recebe um aviso e cada pessoa escolhe o que consumiu."),
    ).not.toBeInTheDocument();
  });

  it("re-enables room creation after the added people are removed", () => {
    const result = makeResult();
    const shared = {
      result,
      onConfirm: vi.fn(),
      onShare: vi.fn(),
      onCancel: vi.fn(),
      onManageParticipants: vi.fn(),
    };
    const { rerender } = render(<ScannedItemsReview {...shared} participants={participants} />);

    expect(screen.getByRole("button", { name: "Criar sala de divisão" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeEnabled();

    rerender(<ScannedItemsReview {...shared} participants={[participants[0]]} />);

    expect(screen.getByRole("button", { name: "Criar sala de divisão" })).toBeEnabled();
    expect(screen.queryByText(blockedMessage)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Adicionar pessoas/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeDisabled();
  });

  it("disables both paths while the receipt is invalid", () => {
    const { onConfirm, onShare } = renderReview(
      makeResult({
        items: [{ description: "Cerveja", quantity: 3, unitPriceCents: 334, totalCents: 1000 }],
        totalCents: 1000,
      }),
      vi.fn(),
      vi.fn(),
      { participants: [participants[0]] },
    );

    expect(screen.getByRole("button", { name: "Criar sala de divisão" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeDisabled();
    expect(onShare).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("prevents a second transition while a room is being created", () => {
    renderReview(makeResult(), vi.fn(), vi.fn(), {
      participants: [participants[0]],
      sharePending: true,
      shareError: "Não foi possível criar a sala. Tente novamente.",
    });

    expect(screen.getByRole("button", { name: "Criando sala..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Adicionar pessoas/ })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível criar a sala. Tente novamente.",
    );
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

  it("shows the parsed quantity and per-unit price in the collapsed row", () => {
    renderReview(
      makeResult({
        items: [
          { description: "Cerveja", quantity: 2, unitPriceCents: 600, totalCents: 1200 },
          { description: "Picanha", quantity: 1, unitPriceCents: 4500, totalCents: 4500 },
        ],
        totalCents: 6270,
      }),
    );

    expect(screen.getByText("2x")).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "R$\u00a06,00 cada"),
    ).toBeInTheDocument();
    expect(screen.queryByText("1x")).not.toBeInTheDocument();
  });

  it("keeps the line total and reprices per unit when the quantity increases", async () => {
    const user = userEvent.setup();
    const { onConfirm, onShare } = renderReview(
      makeResult({
        items: [
          { description: "Cerveja", quantity: 2, unitPriceCents: 600, totalCents: 1200 },
          { description: "Picanha", quantity: 1, unitPriceCents: 4500, totalCents: 4500 },
        ],
        totalCents: 6270,
      }),
      vi.fn(),
      vi.fn(),
      { participants: [participants[0]] },
    );

    await user.click(screen.getByRole("button", { name: "Editar Cerveja" }));
    expect(screen.getByLabelText("Valor total de Cerveja")).toHaveValue("12,00");

    await user.click(screen.getByRole("button", { name: "Aumentar quantidade de Cerveja" }));

    expect(screen.getByLabelText("Valor total de Cerveja")).toHaveValue("12,00");
    fireEvent.click(screen.getByRole("button", { name: "Criar sala de divisão" }));
    expect(onShare).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    const [draft] = onShare.mock.calls[0] as [ReceiptOcrResult, string];
    expect(draft.items[0]).toMatchObject({
      description: "Cerveja",
      quantity: 3000,
      unitPriceCents: 400,
      totalCents: 1200,
    });
    expect(draft.totalCents).toBe(6270);
  });

  it("disables decreasing the quantity at one unit", async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByRole("button", { name: "Editar Picanha 400g" }));
    const decrease = screen.getByRole("button", { name: "Diminuir quantidade de Picanha 400g" });
    expect(decrease).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Aumentar quantidade de Picanha 400g" }));
    expect(decrease).toBeEnabled();
  });

  it("reconciles a rejected amount with the total when the quantity changes", async () => {
    const user = userEvent.setup();
    const { onConfirm, onShare } = renderReview(
      makeResult({
        items: [
          { description: "Cerveja", quantity: 2, unitPriceCents: 500, totalCents: 1000 },
          { description: "Picanha", quantity: 1, unitPriceCents: 4500, totalCents: 4500 },
        ],
        totalCents: 6050,
      }),
      vi.fn(),
      vi.fn(),
      { participants: [participants[0]] },
    );

    await user.click(screen.getByRole("button", { name: "Editar Cerveja" }));
    fireEvent.change(screen.getByLabelText("Valor total de Cerveja"), {
      target: { value: "10,05" },
    });

    expect(screen.getByText("Valor incompatível com a quantidade.")).toBeInTheDocument();
    expect(screen.queryByText("cada")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar sala de divisão" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Aumentar quantidade de Cerveja" }));

    expect(screen.queryByText("Valor incompatível com a quantidade.")).not.toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "R$\u00a03,35 cada"),
    ).toBeInTheDocument();
    const createRoom = screen.getByRole("button", { name: "Criar sala de divisão" });
    expect(createRoom).toBeEnabled();

    fireEvent.click(createRoom);
    expect(onShare).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    const [draft] = onShare.mock.calls[0] as [ReceiptOcrResult, string];
    expect(draft.items[0]).toMatchObject({
      description: "Cerveja",
      quantity: 3000,
      unitPriceCents: 335,
      totalCents: 1005,
    });
  });

  it("keeps fractional quantities editable in whole-unit steps", async () => {
    const user = userEvent.setup();
    renderReview(
      makeResult({
        items: [{ description: "Cerveja", quantity: 0.5, unitPriceCents: 600, totalCents: 300 }],
        totalCents: 330,
      }),
    );

    expect(screen.getByText("0,5x")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Editar Cerveja" }));
    const decrease = screen.getByRole("button", { name: "Diminuir quantidade de Cerveja" });
    expect(decrease).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Aumentar quantidade de Cerveja" }));

    expect(screen.queryByText("0,5x")).not.toBeInTheDocument();
    expect(screen.getAllByText("1,5x").length).toBeGreaterThan(0);
    expect(decrease).toBeEnabled();
  });

  it("flags a quantity whose per-unit price cannot represent the total", async () => {
    const user = userEvent.setup();
    const { onConfirm, onShare } = renderReview(
      makeResult({
        items: [
          { description: "Cerveja", quantity: 2, unitPriceCents: 50, totalCents: 100 },
          { description: "Picanha", quantity: 1, unitPriceCents: 4500, totalCents: 4500 },
        ],
        totalCents: 5060,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Editar Cerveja" }));
    await user.click(screen.getByRole("button", { name: "Aumentar quantidade de Cerveja" }));

    expect(screen.getByText("Valor incompatível com a quantidade.")).toBeInTheDocument();
    expect(screen.queryByText("cada")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Valor total de Cerveja")).toHaveValue("1,00");
    expect(screen.getByRole("button", { name: "Criar sala de divisão" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeDisabled();
    expect(onShare).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("continues with details edited inside the row panel", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 15, 12));
    try {
      const user = userEvent.setup();
      const { onConfirm } = renderReview();

      fireEvent.change(screen.getByLabelText("Nome do estabelecimento"), {
        target: { value: "Mercado" },
      });
      await user.click(screen.getByRole("button", { name: "Editar Cerveja Brahma 600ml" }));
      fireEvent.change(screen.getByLabelText("Nome de Cerveja Brahma 600ml"), {
        target: { value: "Cerveja" },
      });
      fireEvent.change(screen.getByLabelText("Valor total de Cerveja"), { target: { value: "30,00" } });
      await user.click(screen.getByRole("button", { name: "Pronto" }));
      await user.click(screen.getByRole("button", { name: "Data do recibo" }));
      await user.click(screen.getByRole("button", { name: "9 de setembro de 2026" }));
      await user.click(screen.getByRole("button", { name: "Dividir manualmente" }));

      expect(onConfirm).toHaveBeenCalledOnce();
      const [draft, occurredOn] = onConfirm.mock.calls[0] as [ReceiptOcrResult, string];
      expect(draft.merchant).toBe("Mercado");
      expect(draft.items[0]).toMatchObject({
        description: "Cerveja",
        totalCents: 3000,
        quantity: 2000,
      });
      expect(draft.totalCents).toBe(8250);
      expect(occurredOn).toBe("2026-09-09");
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks continue and names the broken row when a name is cleared", async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByRole("button", { name: "Editar Cerveja Brahma 600ml" }));
    fireEvent.change(screen.getByLabelText("Nome de Cerveja Brahma 600ml"), {
      target: { value: "   " },
    });

    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeDisabled();
    expect(screen.queryByLabelText("Valor total de Cerveja")).not.toBeInTheDocument();
  });

  it("lets an unfixable row be removed so continue becomes reachable", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderReview(
      makeResult({
        items: [
          { description: "Cerveja", quantity: 3, unitPriceCents: 334, totalCents: 1000 },
          { description: "Picanha", quantity: 1, unitPriceCents: 4500, totalCents: 4500 },
        ],
        totalCents: 5500,
      }),
    );

    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Editar Cerveja" }));
    await user.click(screen.getByRole("button", { name: "Remover Cerveja" }));

    expect(screen.queryByText("Valor incompatível com a quantidade.")).not.toBeInTheDocument();
    const proceed = screen.getByRole("button", { name: "Dividir manualmente" });
    expect(proceed).toBeEnabled();

    await user.click(proceed);
    const [draft] = onConfirm.mock.calls[0] as [ReceiptOcrResult, string];
    expect(draft.items.map((item) => item.description)).toEqual(["Picanha"]);
  });

  it("shows the empty receipt state and disables continue", () => {
    renderReview(makeResult({ items: [], totalCents: 0 }));

    expect(
      screen.getByText("Nenhum item. Tente escanear novamente ou adicione manualmente."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dividir manualmente" })).toBeDisabled();
  });

  it("shows a fee the receipt printed as an amount", () => {
    renderReview(makeResult({ serviceFeeBasisPoints: 0, fixedFeesCents: 1000, totalCents: 7900 }));

    // Without this line the user sees items summing to 69,00 against a
    // 79,00 total with nothing explaining the difference.
    expect(screen.getByText("Taxa impressa na nota")).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*10,00/)).toBeInTheDocument();
  });

  it("surfaces the printed total when it disagrees with the item-derived total", () => {
    renderReview(makeResult({ totalCents: 7690 }));
    expect(screen.getByText(/Na nota o total impresso é/)).toBeInTheDocument();

    cleanup();

    renderReview(makeResult({ totalCents: 7590 }));
    expect(screen.queryByText(/Na nota o total impresso é/)).toBeNull();
  });
});
