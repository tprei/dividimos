import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ScannedItemsReview } from "./scanned-items-review";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";

const makeResult = (
  overrides?: Partial<ReceiptOcrResult>,
): ReceiptOcrResult => ({
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
  serviceFeePercent: 10,
  totalCents: 6900,
  ...overrides,
});

describe("ScannedItemsReview", () => {
  it("renders merchant name, items, service fee, and total", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ScannedItemsReview
        result={makeResult()}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const merchantInput = screen.getByPlaceholderText(
      "Nome do estabelecimento",
    );
    expect(merchantInput).toHaveValue("Bar do Zé");

    expect(screen.getByText("Cerveja Brahma 600ml")).toBeInTheDocument();
    expect(screen.getByText("Picanha 400g")).toBeInTheDocument();

    expect(screen.getByText("Confirmar")).toBeInTheDocument();
    expect(screen.getByText("Cancelar")).toBeInTheDocument();
  });

  it("calls onCancel when Cancelar is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ScannedItemsReview
        result={makeResult()}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByText("Cancelar"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onConfirm with updated data", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ScannedItemsReview
        result={makeResult()}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();

    const call = onConfirm.mock.calls[0][0] as ReceiptOcrResult;
    expect(call.merchant).toBe("Bar do Zé");
    expect(call.items).toHaveLength(2);
    expect(call.serviceFeePercent).toBe(10);
    expect(call.totalCents).toBe(6900);
  });

  it("allows removing an item", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ScannedItemsReview
        result={makeResult()}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const removeButtons = screen.getAllByLabelText(/Remover/);
    await user.click(removeButtons[0]);

    expect(screen.queryByText("Cerveja Brahma 600ml")).not.toBeInTheDocument();
    expect(screen.getByText("Picanha 400g")).toBeInTheDocument();

    await user.click(screen.getByText("Confirmar"));
    const call = onConfirm.mock.calls[0][0] as ReceiptOcrResult;
    expect(call.items).toHaveLength(1);
    expect(call.totalCents).toBe(4500);
  });

  it("allows editing an item inline", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ScannedItemsReview
        result={makeResult()}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const editButtons = screen.getAllByLabelText(/Editar/);
    await user.click(editButtons[1]); // edit Picanha

    const descInput = screen.getByDisplayValue("Picanha 400g");
    await user.clear(descInput);
    await user.type(descInput, "Picanha 500g");

    await user.click(screen.getByText("Salvar"));

    expect(screen.getByText("Picanha 500g")).toBeInTheDocument();
  });

  it("shows add item form when clicking Adicionar mais item", async () => {
    const user = userEvent.setup();
    render(
      <ScannedItemsReview
        result={makeResult()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Adicionar mais item"));
    expect(
      screen.getByPlaceholderText("Descricao (ex: Picanha 400g)"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("0,00")).toBeInTheDocument();
    // Adicionar button should be disabled when fields are empty
    expect(screen.getByText("Adicionar")).toBeDisabled();
  });

  it("includes manually added items in confirm result", () => {
    const onConfirm = vi.fn();
    const resultWithExtra = makeResult();
    resultWithExtra.items.push({
      description: "Agua mineral",
      quantity: 1,
      unitPriceCents: 500,
      totalCents: 500,
    });
    render(
      <ScannedItemsReview
        result={resultWithExtra}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Agua mineral")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirmar"));
    const call = onConfirm.mock.calls[0][0] as ReceiptOcrResult;
    expect(call.items).toHaveLength(3);
    expect(call.items[2].description).toBe("Agua mineral");
    expect(call.items[2].unitPriceCents).toBe(500);
    expect(call.items[2].totalCents).toBe(500);
  });

  it("disables Confirmar when all items are removed", async () => {
    const user = userEvent.setup();
    render(
      <ScannedItemsReview
        result={makeResult({
          items: [
            {
              description: "Solo item",
              quantity: 1,
              unitPriceCents: 1000,
              totalCents: 1000,
            },
          ],
        })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText("Remover Solo item"));
    expect(screen.getByText("Confirmar")).toBeDisabled();
  });

  it("updates total when items are edited", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ScannedItemsReview
        result={makeResult({
          items: [
            {
              description: "Item A",
              quantity: 1,
              unitPriceCents: 1000,
              totalCents: 1000,
            },
          ],
          totalCents: 1000,
        })}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText("Editar Item A"));
    // Find the unit price input by its current value
    const priceInputs = screen.getAllByRole("textbox");
    const priceInput = priceInputs.find(
      (el) => (el as HTMLInputElement).value === "10,00",
    );
    expect(priceInput).toBeDefined();
    fireEvent.change(priceInput!, { target: { value: "20,00" } });
    await user.click(screen.getByText("Salvar"));

    await user.click(screen.getByText("Confirmar"));
    const call = onConfirm.mock.calls[0][0] as ReceiptOcrResult;
    expect(call.items[0].unitPriceCents).toBe(2000);
    expect(call.items[0].totalCents).toBe(2000);
    expect(call.totalCents).toBe(2000);
  });

  it("handles null merchant in result", () => {
    render(
      <ScannedItemsReview
        result={makeResult({ merchant: null })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const merchantInput = screen.getByPlaceholderText(
      "Nome do estabelecimento",
    );
    expect(merchantInput).toHaveValue("");
  });
});
