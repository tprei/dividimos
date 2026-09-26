import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceBillReview } from "./voice-bill-review";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";

const singleResult: VoiceExpenseResult = {
  title: "Uber",
  amountCents: 2500,
  expenseType: "single_amount",
  items: [],
  participants: [
    { spokenName: "João", matchedHandle: "joao123", confidence: "high" },
  ],
  merchantName: null,
};

const itemizedResult: VoiceExpenseResult = {
  title: "Bar do Zé",
  amountCents: 5500,
  expenseType: "itemized",
  items: [
    { description: "Cerveja", quantity: 2000, unitPriceCents: 1500, totalCents: 3000 },
    { description: "Pizza", quantity: 1000, unitPriceCents: 2500, totalCents: 2500 },
  ],
  participants: [],
  merchantName: "Bar do Zé",
};

const groupMembers = [
  { id: "user-joao", handle: "joao123", name: "João Silva", avatarUrl: undefined },
  { id: "user-maria", handle: "maria_s", name: "Maria Santos", avatarUrl: undefined },
];

describe("VoiceBillReview", () => {
  it("auto-resolves high-confidence member matches and confirms them", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={singleResult}
        groupMembers={groupMembers}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("@joao123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alterar João" })).toBeInTheDocument();

    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][1]).toEqual([
      {
        type: "member",
        userId: "user-joao",
        handle: "joao123",
        name: "João Silva",
        avatarUrl: undefined,
      },
    ]);
  });

  it("blocks confirm and warns while participants are unresolved", () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Maria", matchedHandle: null, confidence: "low" },
      ],
    };
    render(
      <VoiceBillReview result={unmatched} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(
      screen.getByText("Atribua todos os participantes antes de confirmar"),
    ).toBeInTheDocument();
    expect(screen.getByText("Confirmar").closest("button")).toBeDisabled();
  });

  it("opens the member picker from Atribuir", async () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Maria", matchedHandle: null, confidence: "low" },
      ],
    };
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={unmatched}
        groupMembers={groupMembers}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Atribuir Maria" }));

    expect(screen.getByText("Membros do grupo")).toBeInTheDocument();
    expect(screen.getByText("João Silva")).toBeInTheDocument();
    expect(screen.getByText("Adicionar como convidado")).toBeInTheDocument();
  });

  it("passes the exact member when an unresolved participant is matched", async () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Maria", matchedHandle: null, confidence: "low" },
      ],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={unmatched}
        groupMembers={groupMembers}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Atribuir Maria" }));
    await user.click(screen.getByText("Maria Santos"));

    expect(screen.getByText("@maria_s")).toBeInTheDocument();
    expect(
      screen.queryByText("Atribua todos os participantes antes de confirmar"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][1]).toEqual([
      {
        type: "member",
        userId: "user-maria",
        handle: "maria_s",
        name: "Maria Santos",
        avatarUrl: undefined,
      },
    ]);
  });

  it("passes a guest when the participant is added as convidado", async () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Pedro", matchedHandle: null, confidence: "low" },
      ],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={unmatched}
        groupMembers={groupMembers}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Atribuir Pedro" }));
    await user.click(screen.getByText("Adicionar como convidado"));

    expect(screen.getByText("Convidado")).toBeInTheDocument();
    expect(
      screen.queryByText("Atribua todos os participantes antes de confirmar"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][1]).toEqual([
      { type: "guest", name: "Pedro" },
    ]);
  });

  it("clears a resolved match and blocks confirm again", async () => {
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={singleResult}
        groupMembers={groupMembers}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Alterar João" }));

    expect(screen.getByRole("button", { name: "Atribuir João" })).toBeInTheDocument();
    expect(
      screen.getByText("Atribua todos os participantes antes de confirmar"),
    ).toBeInTheDocument();
    expect(screen.getByText("Confirmar").closest("button")).toBeDisabled();
  });

  it("resolves multiple participants independently in spoken order", async () => {
    const multiUnmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Ana", matchedHandle: null, confidence: "low" },
        { spokenName: "Bruno", matchedHandle: null, confidence: "low" },
      ],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={multiUnmatched}
        groupMembers={groupMembers}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Atribuir Ana" }));
    await user.click(screen.getByText("João Silva"));

    expect(screen.getByText("Confirmar").closest("button")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Atribuir Bruno" }));
    await user.click(screen.getByText("Adicionar como convidado"));

    expect(screen.getByText("Confirmar").closest("button")).not.toBeDisabled();

    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    const resolved = onConfirm.mock.calls[0][1];
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toMatchObject({ type: "member", name: "João Silva" });
    expect(resolved[1]).toEqual({ type: "guest", name: "Bruno" });
  });

  it("reaches onConfirm with an edited title", async () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={noParticipantResult}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Nome da conta: Uber" }));

    const titleInput = screen.getByRole("textbox", { name: "Nome da conta" });
    expect(titleInput).toHaveValue("Uber");
    fireEvent.change(titleInput, { target: { value: "Táxi" } });
    fireEvent.blur(titleInput);

    expect(screen.getByRole("button", { name: "Nome da conta: Táxi" })).toBeInTheDocument();

    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][0].title).toBe("Táxi");
  });

  it("reaches onConfirm with an edited amount", async () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={noParticipantResult}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Valor total: R\$\s25,00/ }));

    const amountInput = screen.getByRole("textbox", { name: "Valor total" });
    expect(amountInput).toHaveValue("25,00");
    fireEvent.change(amountInput, { target: { value: "42,50" } });

    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][0].amountCents).toBe(4250);
  });

  it("passes the original title and amount when nothing was edited", async () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={noParticipantResult}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][0].title).toBe("Uber");
    expect(onConfirm.mock.calls[0][0].amountCents).toBe(2500);
    expect(onConfirm.mock.calls[0][0].merchantName).toBeNull();
  });

  it("blocks zero amount only for single_amount", () => {
    const zeroResult: VoiceExpenseResult = {
      ...singleResult,
      amountCents: 0,
      participants: [],
    };
    const { unmount } = render(
      <VoiceBillReview result={zeroResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(
      screen.getByText("Informe o valor antes de confirmar"),
    ).toBeInTheDocument();
    expect(screen.getByText("Confirmar").closest("button")).toBeDisabled();
    unmount();

    const itemizedZero: VoiceExpenseResult = {
      ...itemizedResult,
      amountCents: 0,
    };
    render(
      <VoiceBillReview result={itemizedZero} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(
      screen.queryByText("Informe o valor antes de confirmar"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Confirmar").closest("button")).not.toBeDisabled();
  });

  it("reaches onConfirm with an edited merchant", async () => {
    const merchantResult: VoiceExpenseResult = {
      ...singleResult,
      merchantName: "Padaria Central",
      participants: [],
    };
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={merchantResult}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const merchantInput = screen.getByRole("textbox", { name: "Estabelecimento" });
    expect(merchantInput).toHaveValue("Padaria Central");
    fireEvent.change(merchantInput, { target: { value: "Boteco Legal" } });

    await user.click(screen.getByText("Confirmar"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0][0].merchantName).toBe("Boteco Legal");
  });

  it("has no merchant field when the parser returned none", () => {
    render(
      <VoiceBillReview result={singleResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(
      screen.queryByRole("textbox", { name: "Estabelecimento" }),
    ).not.toBeInTheDocument();
  });

  it("falls back to Sem título for an empty title", () => {
    const emptyTitleResult: VoiceExpenseResult = {
      ...singleResult,
      title: "",
      participants: [],
    };
    render(
      <VoiceBillReview result={emptyTitleResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Nome da conta: Sem título" }),
    ).toBeInTheDocument();
  });

  it("cancels right away when the review is untouched", async () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={noParticipantResult}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByText("Voltar"));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByText("Descartar o rascunho?")).not.toBeInTheDocument();
  });

  it("treats assigning a participant as an edit, so Voltar asks before discarding", async () => {
    const unmatched: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Maria", matchedHandle: null, confidence: "low" },
      ],
    };
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={unmatched}
        groupMembers={groupMembers}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Atribuir Maria" }));
    await user.click(screen.getByText("Maria Santos"));

    await user.click(screen.getByText("Voltar"));
    expect(screen.getByText("Descartar o rascunho?")).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("finishes title editing on Enter", () => {
    const noParticipantResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [],
    };
    render(
      <VoiceBillReview result={noParticipantResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Nome da conta: Uber" }));
    const titleInput = screen.getByRole("textbox", { name: "Nome da conta" });
    fireEvent.change(titleInput, { target: { value: "Táxi" } });
    fireEvent.keyDown(titleInput, { key: "Enter" });

    expect(
      screen.queryByRole("textbox", { name: "Nome da conta" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nome da conta: Táxi" })).toBeInTheDocument();
  });

  it("only cancels after the discard dialog confirms an edited review", async () => {
    const merchantResult: VoiceExpenseResult = {
      ...singleResult,
      merchantName: "Padaria Central",
      participants: [],
    };
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <VoiceBillReview
        result={merchantResult}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Estabelecimento" }), {
      target: { value: "Boteco Legal" },
    });

    await user.click(screen.getByText("Voltar"));
    expect(screen.getByText("Descartar o rascunho?")).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByText("Manter rascunho"));
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByText("Voltar"));
    await user.click(screen.getByText("Descartar rascunho"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows items and the quantity breakdown only for quantity above one", () => {
    render(
      <VoiceBillReview result={itemizedResult} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByText("Cerveja")).toBeInTheDocument();
    expect(screen.getByText("Pizza")).toBeInTheDocument();
    expect(screen.getByText(/2x/)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 15,00 un\./)).toBeInTheDocument();
    expect(screen.queryByText(/1x/)).not.toBeInTheDocument();
  });

  it("shows the suggested handle with a question mark for medium confidence", () => {
    const mediumResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "Jo", matchedHandle: "joao123", confidence: "medium" },
      ],
    };
    render(
      <VoiceBillReview
        result={mediumResult}
        groupMembers={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("@joao123 ?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atribuir Jo" })).toBeInTheDocument();
  });

  it("shows Não identificado for low confidence without a handle", () => {
    const lowResult: VoiceExpenseResult = {
      ...singleResult,
      participants: [
        { spokenName: "???", matchedHandle: null, confidence: "low" },
      ],
    };
    render(
      <VoiceBillReview
        result={lowResult}
        groupMembers={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Não identificado")).toBeInTheDocument();
  });
});
