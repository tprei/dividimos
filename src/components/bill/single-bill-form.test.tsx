import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { buildExpensePayload } from "@/lib/ledger/payload";
import { hasMeaningfulDraft } from "@/lib/bill-draft";
import { runBackHandlers, __resetBackHandlerStackForTests } from "@/lib/capacitor/back-handler";
import { useBillStore } from "@/stores/bill-store";
import { userAlice, userBob } from "@/test/fixtures";
import type { Me } from "@/types/ledger";
import { SingleBillForm } from "./single-bill-form";

const { createGroupMock, getOrCreateDmMock } = vi.hoisted(() => ({
  createGroupMock: vi.fn(),
  getOrCreateDmMock: vi.fn(),
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  createGroup: createGroupMock,
  getOrCreateDm: getOrCreateDmMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() }),
}));

const me: Me = {
  id: userAlice.id,
  handle: userAlice.handle,
  name: userAlice.name,
  avatarUrl: userAlice.avatarUrl ?? null,
  isBot: false,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

function prepareStore(totalAmountInput = 10000) {
  const store = useBillStore.getState();
  store.setCurrentUser(userAlice);
  store.createExpense("Conta", "single_amount");
  store.updateExpense({ totalAmountInput });
  store.addParticipant(userBob);
}

function renderForm({ submit = vi.fn().mockResolvedValue(false), onBack = vi.fn() } = {}) {
  return {
    submit,
    onBack,
    ...render(
      <SingleBillForm
        me={me}
        groups={[]}
        initialGroupId={null}
        isDmMode={false}
        isEditing={false}
        hasContactPicker={false}
        onPickContacts={vi.fn().mockResolvedValue(undefined)}
        onBack={onBack}
        submit={submit}
        submitting={false}
      />,
    ),
  };
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

function chooseMode(group: string, label: string) {
  fireEvent.click(within(screen.getByRole("radiogroup", { name: `Como dividir: ${group}` })).getByLabelText(label));
}

beforeEach(() => {
  __resetBackHandlerStackForTests();
  useBillStore.getState().reset();
  useBillStore.setState({ currentUser: null });
  prepareStore();
  createGroupMock.mockReset();
  getOrCreateDmMock.mockReset();
  getOrCreateDmMock.mockResolvedValue({ groupId: "dm-1" });
  createGroupMock.mockResolvedValue({ groupId: "group-1" });
});

describe("SingleBillForm journey", () => {
  it("does not turn an untouched form into an authored draft", () => {
    const store = useBillStore.getState();
    store.updateExpense({ title: "", totalAmountInput: 0 });
    store.removeParticipant(userBob.id);
    renderForm();
    expect(hasMeaningfulDraft(useBillStore.getState(), me.id)).toBe(false);
  });

  it("holds each step until it is complete and says why", async () => {
    useBillStore.getState().updateExpense({ title: " " });
    useBillStore.getState().removeParticipant(userBob.id);
    renderForm();
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nome da conta"), { target: { value: "Pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pular" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Falta alguém pra dividir com você.");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    act(() => useBillStore.getState().addParticipant(userBob));
    next();
    expect(screen.getByLabelText("Valor total")).toBeInTheDocument();
  });

  it("goes back one step on hardware back before leaving", () => {
    const { onBack } = renderForm();
    next();
    expect(screen.getByLabelText("Valor total")).toBeInTheDocument();

    act(() => {
      runBackHandlers();
    });
    expect(screen.getByLabelText("Nome da conta")).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();

    act(() => {
      runBackHandlers();
    });
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("SingleBillForm consumption split", () => {
  it("sets the other person to the complement as a percentage is typed", async () => {
    renderForm();
    next();
    chooseMode("Quem consumiu", "%");
    fireEvent.change(screen.getByRole("textbox", { name: "Percentual que Alice Silva consumiu" }), {
      target: { value: "40" },
    });

    expect(screen.getByRole("textbox", { name: "Percentual que Bob Santos consumiu" })).toHaveValue("60");
    await waitFor(() =>
      expect(useBillStore.getState().billSplits.map((split) => [split.userId, split.splitType, split.computedAmountCents])).toEqual([
        [userAlice.id, "percentage", 4000],
        [userBob.id, "percentage", 6000],
      ]),
    );
  });

  it("carries typed amounts over as percentages when the mode changes", () => {
    renderForm();
    next();
    chooseMode("Quem consumiu", "Valores");
    fireEvent.change(screen.getByRole("textbox", { name: "Valor que Alice Silva consumiu" }), {
      target: { value: "25" },
    });
    chooseMode("Quem consumiu", "%");

    expect(screen.getByRole("textbox", { name: "Percentual que Alice Silva consumiu" })).toHaveValue("25");
    expect(screen.getByRole("textbox", { name: "Percentual que Bob Santos consumiu" })).toHaveValue("75");
  });

  it("keeps a typed amount and moves the difference when the total changes", async () => {
    renderForm();
    next();
    chooseMode("Quem consumiu", "Valores");
    fireEvent.change(screen.getByRole("textbox", { name: "Valor que Alice Silva consumiu" }), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Valor total"), { target: { value: "150" } });

    expect(screen.getByRole("textbox", { name: "Valor que Alice Silva consumiu" })).toHaveValue("30");
    expect(screen.getByRole("textbox", { name: "Valor que Bob Santos consumiu" })).toHaveValue("120,00");
    await waitFor(() =>
      expect(useBillStore.getState().billSplits.map((split) => split.computedAmountCents)).toEqual([3000, 12000]),
    );
  });

  it("balances typed amounts to the total and persists exactly what is shown", async () => {
    renderForm();
    next();
    chooseMode("Quem consumiu", "Valores");
    fireEvent.change(screen.getByRole("textbox", { name: "Valor que Alice Silva consumiu" }), {
      target: { value: "33,33" },
    });

    expect(screen.getByRole("textbox", { name: "Valor que Bob Santos consumiu" })).toHaveValue("66,67");
    await waitFor(() => expect(useBillStore.getState().billSplits[0]?.computedAmountCents).toBe(3333));

    const state = useBillStore.getState();
    const result = buildExpensePayload(state, "2026-09-10");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payload.shares).toEqual([3333, 6667]);
    expect(result.value.payload.splitMethod).toBe("fixed");
  });

  it("splits equally among only the people still included", async () => {
    renderForm();
    next();
    fireEvent.click(within(screen.getByRole("list", { name: "Quem consumiu" })).getByRole("button", { name: /Bob/ }));

    await waitFor(() =>
      expect(useBillStore.getState().billSplits.map((split) => [split.userId, split.computedAmountCents])).toEqual([
        [userAlice.id, 10000],
      ]),
    );
  });
});

describe("SingleBillForm payers", () => {
  it("defaults to the viewer paying everything", async () => {
    renderForm();
    next();
    next();
    await waitFor(() =>
      expect(useBillStore.getState().payers.map((payer) => [payer.userId, payer.amountCents])).toEqual([
        [userAlice.id, 10000],
      ]),
    );
    expect(screen.getByRole("button", { name: "Salvar conta" })).toBeEnabled();
  });

  it("completes the other payer's percentage and stores exact centavos", async () => {
    renderForm();
    next();
    next();
    fireEvent.click(within(screen.getByRole("list", { name: "Quem pagou" })).getByRole("button", { name: /Bob/ }));
    chooseMode("Quem pagou", "%");
    fireEvent.change(screen.getByRole("textbox", { name: "Percentual que Alice Silva pagou" }), {
      target: { value: "30" },
    });

    expect(screen.getByRole("textbox", { name: "Percentual que Bob Santos pagou" })).toHaveValue("70");
    await waitFor(() =>
      expect(useBillStore.getState().payers.map((payer) => [payer.userId, payer.amountCents])).toEqual([
        [userAlice.id, 3000],
        [userBob.id, 7000],
      ]),
    );
  });

  it("will not save while nobody is marked as having paid", () => {
    renderForm();
    next();
    next();
    fireEvent.click(within(screen.getByRole("list", { name: "Quem pagou" })).getByRole("button", { name: "Você" }));
    expect(screen.getByRole("button", { name: "Salvar conta" })).toBeDisabled();
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toContain("Escolha quem pagou.");
  });
});

describe("SingleBillForm submit", () => {
  it("keeps the authored split when submit fails", async () => {
    const { submit } = renderForm();
    next();
    chooseMode("Quem consumiu", "%");
    fireEvent.change(screen.getByRole("textbox", { name: "Percentual que Bob Santos consumiu" }), {
      target: { value: "40" },
    });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    await expect(submit.mock.calls[0][0]()).resolves.toEqual({ kind: "existing", groupId: "dm-1" });

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.getByRole("textbox", { name: "Percentual que Alice Silva consumiu" })).toHaveValue("60");
  });

  it("adopts a group the page resolves after mount and submits into it", async () => {
    const submit = vi.fn().mockResolvedValue(false);
    const group = {
      group: { id: "g-late", kind: "group" as const, name: "Viagem", creatorId: me.id, dmUserA: null, dmUserB: null, ledgerVersion: 1, createdAt: "2026-01-01T00:00:00Z" },
      members: [],
      balances: [],
      guests: [],
      settlements: [],
      recentExpenses: [],
      lastEventId: 0,
      unreadCount: 0,
      lastMessage: null,
      lastActivityAt: "2026-01-01T00:00:00Z",
      expenseCount: 0,
      pairwiseEdges: [],
    };
    const props = {
      me,
      groups: [group],
      isDmMode: false,
      isEditing: false,
      hasContactPicker: false,
      onPickContacts: vi.fn().mockResolvedValue(undefined),
      onBack: vi.fn(),
      submit,
      submitting: false,
    };
    const { rerender } = render(<SingleBillForm {...props} initialGroupId={null} />);
    rerender(<SingleBillForm {...props} initialGroupId="g-late" />);

    expect(screen.getByRole("button", { name: "Grupo: Viagem" })).toBeInTheDocument();
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    await expect(submit.mock.calls[0][0]()).resolves.toEqual({ kind: "existing", groupId: "g-late" });
    expect(getOrCreateDmMock).not.toHaveBeenCalled();
    expect(createGroupMock).not.toHaveBeenCalled();
  });
});
