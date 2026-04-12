import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatDraftCard } from "./chat-draft-card";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

function makeResult(overrides: Partial<ChatExpenseResult> = {}): ChatExpenseResult {
  return {
    title: "Uber",
    amountCents: 2500,
    expenseType: "single_amount",
    splitType: "equal",
    items: [],
    participants: [],
    payerHandle: null,
    merchantName: null,
    confidence: "high",
    ...overrides,
  };
}

describe("ChatDraftCard", () => {
  const defaultProps = {
    result: makeResult(),
    onConfirm: vi.fn(),
    onEdit: vi.fn(),
  };

  it("renders title and amount", () => {
    render(<ChatDraftCard {...defaultProps} />);

    expect(screen.getByTestId("draft-title")).toHaveTextContent("Uber");
    expect(screen.getByTestId("draft-amount")).toHaveTextContent("R$");
    expect(screen.getByTestId("draft-amount")).toHaveTextContent("25,00");
  });

  it("renders split type label for equal split", () => {
    render(<ChatDraftCard {...defaultProps} />);

    expect(screen.getByTestId("draft-split-type")).toHaveTextContent("Divisão igual");
  });

  it("renders split type label for custom split", () => {
    render(
      <ChatDraftCard
        {...defaultProps}
        result={makeResult({ splitType: "custom" })}
      />,
    );

    expect(screen.getByTestId("draft-split-type")).toHaveTextContent(
      "Divisão personalizada",
    );
  });

  it("renders fallback title when empty", () => {
    render(
      <ChatDraftCard
        {...defaultProps}
        result={makeResult({ title: "" })}
      />,
    );

    expect(screen.getByTestId("draft-title")).toHaveTextContent("Sem título");
  });

  it("renders merchant name when present", () => {
    render(
      <ChatDraftCard
        {...defaultProps}
        result={makeResult({ merchantName: "Bar do Zé" })}
      />,
    );

    expect(screen.getByText("— Bar do Zé")).toBeInTheDocument();
  });

  it("does not render merchant when absent", () => {
    render(<ChatDraftCard {...defaultProps} />);

    expect(screen.queryByText(/—/)).not.toBeInTheDocument();
  });

  it("renders items for itemized expense", () => {
    const result = makeResult({
      expenseType: "itemized",
      items: [
        { description: "Cerveja", quantity: 2, unitPriceCents: 1500, totalCents: 3000 },
        { description: "Batata", quantity: 1, unitPriceCents: 2000, totalCents: 2000 },
      ],
      amountCents: 5000,
    });

    render(<ChatDraftCard {...defaultProps} result={result} />);

    expect(screen.getByText("2x Cerveja")).toBeInTheDocument();
    expect(screen.getByText("Batata")).toBeInTheDocument();
  });

  it("renders participants with handles", () => {
    const result = makeResult({
      participants: [
        { spokenName: "Maria", matchedHandle: "maria123", confidence: "high" },
        { spokenName: "João", matchedHandle: null, confidence: "low" },
      ],
    });

    render(<ChatDraftCard {...defaultProps} result={result} />);

    expect(screen.getByText("@maria123, João")).toBeInTheDocument();
  });

  it("renders payer as 'você' for SELF", () => {
    render(
      <ChatDraftCard
        {...defaultProps}
        result={makeResult({ payerHandle: "SELF" })}
      />,
    );

    expect(screen.getByTestId("draft-payer")).toHaveTextContent("Pago por você");
  });

  it("renders payer handle when not SELF", () => {
    render(
      <ChatDraftCard
        {...defaultProps}
        result={makeResult({ payerHandle: "joao" })}
      />,
    );

    expect(screen.getByTestId("draft-payer")).toHaveTextContent("Pago por @joao");
  });

  it("does not render payer when null", () => {
    render(<ChatDraftCard {...defaultProps} />);

    expect(screen.queryByTestId("draft-payer")).not.toBeInTheDocument();
  });

  describe("confidence display", () => {
    it("shows high confidence badge", () => {
      render(<ChatDraftCard {...defaultProps} />);

      expect(screen.getByTestId("confidence-badge")).toHaveTextContent(
        "Alta confiança",
      );
    });

    it("shows medium confidence badge", () => {
      render(
        <ChatDraftCard
          {...defaultProps}
          result={makeResult({ confidence: "medium" })}
        />,
      );

      expect(screen.getByTestId("confidence-badge")).toHaveTextContent(
        "Confiança média",
      );
    });

    it("shows low confidence badge and warning", () => {
      render(
        <ChatDraftCard
          {...defaultProps}
          result={makeResult({ confidence: "low" })}
        />,
      );

      expect(screen.getByTestId("confidence-badge")).toHaveTextContent(
        "Baixa confiança",
      );
      expect(screen.getByTestId("low-confidence-warning")).toBeInTheDocument();
      expect(
        screen.getByText(
          "A IA não tem certeza sobre alguns dados. Revise antes de confirmar.",
        ),
      ).toBeInTheDocument();
    });

    it("does not show warning for high confidence", () => {
      render(<ChatDraftCard {...defaultProps} />);

      expect(screen.queryByTestId("low-confidence-warning")).not.toBeInTheDocument();
    });
  });

  describe("buttons", () => {
    it("calls onConfirm with result when Confirmar clicked", async () => {
      const onConfirm = vi.fn();
      const user = userEvent.setup();
      const result = makeResult();

      render(
        <ChatDraftCard result={result} onConfirm={onConfirm} onEdit={vi.fn()} />,
      );

      await user.click(screen.getByTestId("draft-confirm-button"));
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onConfirm).toHaveBeenCalledWith(result);
    });

    it("calls onEdit with result when Editar clicked", async () => {
      const onEdit = vi.fn();
      const user = userEvent.setup();
      const result = makeResult();

      render(
        <ChatDraftCard result={result} onConfirm={vi.fn()} onEdit={onEdit} />,
      );

      await user.click(screen.getByTestId("draft-edit-button"));
      expect(onEdit).toHaveBeenCalledOnce();
      expect(onEdit).toHaveBeenCalledWith(result);
    });

    it("disables Confirmar when single_amount has no amount", () => {
      render(
        <ChatDraftCard
          {...defaultProps}
          result={makeResult({ amountCents: 0, expenseType: "single_amount" })}
        />,
      );

      expect(screen.getByTestId("draft-confirm-button")).toBeDisabled();
    });

    it("enables Confirmar when itemized has no explicit amount", () => {
      render(
        <ChatDraftCard
          {...defaultProps}
          result={makeResult({ amountCents: 0, expenseType: "itemized" })}
        />,
      );

      expect(screen.getByTestId("draft-confirm-button")).toBeEnabled();
    });
  });

  describe("status states", () => {
    it("shows loading spinner and disables buttons when confirming", () => {
      render(<ChatDraftCard {...defaultProps} status="confirming" />);

      expect(screen.getByTestId("draft-confirm-button")).toBeDisabled();
      expect(screen.getByTestId("draft-edit-button")).toBeDisabled();
      expect(screen.getByTestId("draft-confirm-button")).toHaveTextContent(
        "Confirmando…",
      );
    });

    it("shows confirmed badge and hides buttons when confirmed", () => {
      render(<ChatDraftCard {...defaultProps} status="confirmed" />);

      expect(screen.getByTestId("confirmed-badge")).toHaveTextContent(
        "Confirmada",
      );
      expect(screen.queryByTestId("draft-confirm-button")).not.toBeInTheDocument();
      expect(screen.queryByTestId("draft-edit-button")).not.toBeInTheDocument();
    });

    it("hides low confidence warning when confirmed", () => {
      render(
        <ChatDraftCard
          {...defaultProps}
          result={makeResult({ confidence: "low" })}
          status="confirmed"
        />,
      );

      expect(screen.queryByTestId("low-confidence-warning")).not.toBeInTheDocument();
    });

    it("shows error message when status is error", () => {
      render(
        <ChatDraftCard
          {...defaultProps}
          status="error"
          errorMessage="Falha ao ativar despesa"
        />,
      );

      expect(screen.getByTestId("draft-error")).toHaveTextContent(
        "Falha ao ativar despesa",
      );
    });

    it("does not show error when status is error but no message", () => {
      render(<ChatDraftCard {...defaultProps} status="error" />);

      expect(screen.queryByTestId("draft-error")).not.toBeInTheDocument();
    });

    it("keeps buttons enabled after error for retry", () => {
      render(
        <ChatDraftCard
          {...defaultProps}
          status="error"
          errorMessage="Algo deu errado"
        />,
      );

      expect(screen.getByTestId("draft-confirm-button")).toBeEnabled();
      expect(screen.getByTestId("draft-edit-button")).toBeEnabled();
    });
  });
});
