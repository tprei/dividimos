import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBackHandlers, __resetBackHandlerStackForTests } from "@/lib/capacitor/back-handler";
import { useBillStore } from "@/stores/bill-store";
import { userAlice, userBob } from "@/test/fixtures";
import type { Me } from "@/types/ledger";
import { ItemizedBillForm, type ItemizedSectionKey } from "./itemized-bill-form";

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

function prepareStore(title = "", withBob = true) {
  const store = useBillStore.getState();
  store.setCurrentUser(userAlice);
  store.createExpense(title, "itemized");
  if (withBob) store.addParticipant(userBob);
}

function renderForm(initialSection?: ItemizedSectionKey) {
  const onSubmit = vi.fn().mockResolvedValue(true);
  const onBack = vi.fn();
  render(
    <ItemizedBillForm
      me={me}
      groups={[]}
      selectedGroupId={null}
      createGroupEnabled={false}
      createGroupName=""
      hasContactPicker={false}
      onSelectGroup={vi.fn()}
      onToggleCreateGroup={vi.fn()}
      onCreateGroupName={vi.fn()}
      onAddParticipant={vi.fn()}
      onRemoveParticipant={vi.fn()}
      onAddGuest={vi.fn()}
      onRemoveGuest={vi.fn()}
      onPickContacts={vi.fn().mockResolvedValue(undefined)}
      onSubmit={onSubmit}
      onBack={onBack}
      {...(initialSection ? { initialSection } : {})}
    />,
  );
  return { onSubmit, onBack };
}

function prepareAssignedBill() {
  prepareStore("Churrasco", true);
  act(() => {
    const store = useBillStore.getState();
    store.addItem({ description: "Picanha", quantity: 1000, unitPriceCents: 10000, totalPriceCents: 10000 });
    store.splitItemEqually(useBillStore.getState().items[0].id, [userAlice.id, userBob.id]);
  });
}

function chooseMode(group: string, label: string) {
  fireEvent.click(within(screen.getByRole("radiogroup", { name: `Como dividir: ${group}` })).getByLabelText(label));
}

beforeEach(() => {
  __resetBackHandlerStackForTests();
  useBillStore.getState().reset();
  useBillStore.setState({ currentUser: null });
});

describe("ItemizedBillForm Participantes section", () => {
  it("opens with the bill name, date, group, and people inline", () => {
    renderForm();
    expect(screen.getByLabelText("Nome da conta")).toHaveValue("");
    expect(screen.getByRole("button", { name: /Data/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Grupo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Por @handle" })).toBeInTheDocument();
  });

  it("blocks Continuar until the bill has a name and two people", () => {
    prepareStore("", false);
    renderForm();
    const continuar = screen.getByRole("button", { name: "Continuar" });
    expect(continuar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nome da conta"), { target: { value: "Churrasco" } });
    expect(continuar).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Adicione quem divide com você.");
    act(() => useBillStore.getState().addParticipant(userBob));
    expect(continuar).toBeEnabled();
    fireEvent.click(continuar);
    expect(screen.getByPlaceholderText("Descrição (ex: Picanha 400g)")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Ainda não tem nenhum item.");
  });

  it("steps back on hardware back before leaving the wizard", () => {
    prepareStore("Churrasco", true);
    const { onBack } = renderForm("items");

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

  it("keeps the division editor open after its first autosave", () => {
    vi.useFakeTimers();
    try {
      useBillStore.getState().addItem({
        description: "Pizza",
        quantity: 1000,
        unitPriceCents: 5000,
        totalPriceCents: 5000,
      });
      renderForm("split");

      fireEvent.click(screen.getByRole("button", { name: /Pizza/ }));
      fireEvent.click(screen.getByRole("radio", { name: "Percentual" }));

      // The editor autosaves 400ms after a valid change; it must not collapse
      // out from under the person still editing.
      act(() => {
        vi.advanceTimersByTime(600);
      });

      expect(screen.getByText("Pessoas")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ItemizedBillForm Divisão gate", () => {
  it("blocks Continuar while an item is only partly assigned, and says what is missing", () => {
    prepareStore("Churrasco", true);
    act(() => {
      useBillStore.getState().addItem({
        description: "Picanha",
        quantity: 1000,
        unitPriceCents: 10000,
        totalPriceCents: 10000,
      });
    });

    renderForm("split");

    const continuar = screen.getByRole("button", { name: "Continuar" });
    expect(continuar).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Faltam R$ 100,00");
  });

  it("lets the user continue once every item is assigned", () => {
    prepareStore("Churrasco", true);
    act(() => {
      const store = useBillStore.getState();
      store.addItem({
        description: "Picanha",
        quantity: 1000,
        unitPriceCents: 10000,
        totalPriceCents: 10000,
      });
      const item = useBillStore.getState().items[0];
      store.splitItemEqually(item.id, [userAlice.id, userBob.id]);
    });

    renderForm("split");

    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });
});

describe("ItemizedBillForm batch assignment", () => {
  it("assigns a fifty-item receipt without opening a single item", () => {
    prepareStore("Churrascão", true);
    act(() => {
      const store = useBillStore.getState();
      for (let index = 0; index < 50; index += 1) {
        store.addItem({
          description: `Item ${index + 1}`,
          quantity: 1000,
          unitPriceCents: 1000,
          totalPriceCents: 1000,
        });
      }
    });

    renderForm("split");

    fireEvent.click(screen.getByLabelText("Selecionar todos"));
    expect(screen.getByText("50 de 50 selecionados")).toBeInTheDocument();

    const batch = screen.getByRole("group", { name: "Dividir itens selecionados entre" });
    fireEvent.click(within(batch).getByRole("button", { name: "Você" }));
    fireEvent.click(within(batch).getByRole("button", { name: "Bob" }));
    fireEvent.click(screen.getByRole("button", { name: "Dividir 50 itens igualmente" }));

    // Every item is now fully assigned, so nothing blocks the next step.
    const splits = useBillStore.getState().splits;
    expect(new Set(splits.map((split) => split.itemId)).size).toBe(50);
    expect(splits).toHaveLength(100);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
    expect(screen.queryByText("Pendente")).not.toBeInTheDocument();
  });

  it("announces which people the batch will include", () => {
    prepareStore("Churrasco", true);
    act(() => {
      const store = useBillStore.getState();
      // Batch controls appear once a receipt is long enough to need them.
      for (let index = 0; index < 8; index += 1) {
        store.addItem({
          description: index === 0 ? "Picanha" : `Item ${index}`,
          quantity: 1000,
          unitPriceCents: 10000,
          totalPriceCents: 10000,
        });
      }
    });

    renderForm("split");
    fireEvent.click(screen.getByLabelText("Selecionar Picanha"));

    const batch = screen.getByRole("group", { name: "Dividir itens selecionados entre" });
    const viewer = within(batch).getByRole("button", { name: "Você" });
    expect(viewer).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(viewer);
    expect(within(batch).getByRole("button", { name: "Você" })).toHaveAttribute("aria-pressed", "true");
  });

  it("writes the whole batch in a single store update", () => {
    prepareStore("Churrasco", true);
    act(() => {
      const store = useBillStore.getState();
      for (let index = 0; index < 10; index += 1) {
        store.addItem({
          description: `Item ${index + 1}`,
          quantity: 1000,
          unitPriceCents: 500,
          totalPriceCents: 500,
        });
      }
    });

    let writes = 0;
    const unsubscribe = useBillStore.subscribe(() => {
      writes += 1;
    });
    act(() => {
      useBillStore
        .getState()
        .assignItemsEqually(
          useBillStore.getState().items.map((item) => item.id),
          [userAlice.id, userBob.id],
        );
    });
    unsubscribe();

    expect(writes).toBe(1);
  });

  it("keeps a short receipt free of batch controls", () => {
    prepareStore("Churrasco", true);
    act(() => {
      const store = useBillStore.getState();
      for (let index = 0; index < 3; index += 1) {
        store.addItem({
          description: `Item ${index + 1}`,
          quantity: 1000,
          unitPriceCents: 1000,
          totalPriceCents: 1000,
        });
      }
    });

    renderForm("split");

    expect(screen.queryByLabelText("Selecionar todos")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Selecionar Item 1")).not.toBeInTheDocument();
    // The per-item editor is still the way to divide a short receipt.
    fireEvent.click(screen.getByRole("button", { name: /Item 1/ }));
    expect(screen.getByText("Pessoas")).toBeInTheDocument();
  });
});

describe("ItemizedBillForm payers", () => {
  it("defaults to the viewer paying the grand total, service fee included", async () => {
    prepareAssignedBill();
    const { onSubmit } = renderForm("payment");

    await waitFor(() =>
      expect(useBillStore.getState().payers.map((payer) => [payer.userId, payer.amountCents])).toEqual([
        [userAlice.id, 11000],
      ]),
    );
    const save = screen.getByRole("button", { name: "Salvar conta" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  });

  it("completes the other payer's percentage and stores exact centavos", async () => {
    prepareAssignedBill();
    renderForm("payment");

    fireEvent.click(within(screen.getByRole("list", { name: "Quem pagou" })).getByRole("button", { name: /Bob/ }));
    chooseMode("Quem pagou", "%");
    fireEvent.change(screen.getByRole("textbox", { name: "Percentual que Alice Silva pagou" }), {
      target: { value: "30" },
    });

    expect(screen.getByRole("textbox", { name: "Percentual que Bob Santos pagou" })).toHaveValue("70");
    await waitFor(() =>
      expect(useBillStore.getState().payers.map((payer) => [payer.userId, payer.amountCents])).toEqual([
        [userAlice.id, 3300],
        [userBob.id, 7700],
      ]),
    );
  });

  it("shows who owes whom with each share of the service fee", async () => {
    prepareAssignedBill();
    renderForm("payment");

    const summary = screen.getByRole("region", { name: "Como fica" });
    await waitFor(() => expect(summary).toHaveTextContent(/recebe\s*R\$\s*55,00/));
    expect(summary).toHaveTextContent(/deve\s*R\$\s*55,00/);
  });

  it("will not save while nobody is marked as having paid", () => {
    prepareAssignedBill();
    renderForm("payment");

    fireEvent.click(within(screen.getByRole("list", { name: "Quem pagou" })).getByRole("button", { name: "Você" }));
    expect(screen.getByRole("button", { name: "Salvar conta" })).toBeDisabled();
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toContain("Escolha quem pagou.");
  });
});
