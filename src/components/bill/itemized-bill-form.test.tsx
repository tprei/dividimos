import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { todayIsoDate } from "@/app/app/bill/new/use-wizard-submit";
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
  return render(
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
      onSubmit={vi.fn().mockResolvedValue(true)}
      onBack={vi.fn()}
      {...(initialSection ? { initialSection } : {})}
    />,
  );
}

beforeEach(() => {
  useBillStore.getState().reset();
  useBillStore.setState({ currentUser: null });
});

describe("ItemizedBillForm Conta section", () => {
  it("opens on Conta with title, date, group, and participants entry points", () => {
    renderForm();
    expect(screen.getByRole("tab", { name: "Conta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "Nome" })).toHaveValue("");
    const [year, month, day] = todayIsoDate().split("-");
    expect(screen.getByRole("button", { name: "Data" })).toHaveTextContent(`${day}/${month}/${year}`);
    expect(screen.getByRole("combobox", { name: "Grupo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Participantes/ })).toBeInTheDocument();
  });

  it("blocks Continuar until Conta has a title and two people", () => {
    prepareStore("", false);
    renderForm();
    const continuar = screen.getByRole("button", { name: "Continuar" });
    expect(continuar).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Nome" }), { target: { value: "Churrasco" } });
    expect(continuar).toBeDisabled();
    act(() => useBillStore.getState().addParticipant(userBob));
    expect(continuar).toBeEnabled();
    fireEvent.click(continuar);
    expect(screen.getByRole("tab", { name: "Itens" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the scan handoff on Quem consumiu without the participants disclosure", () => {
    useBillStore.getState().addItem({ description: "Pizza", quantity: 1000, unitPriceCents: 5000, totalPriceCents: 5000 });
    renderForm("split");
    expect(screen.getByRole("tab", { name: "Quem consumiu" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: /Participantes/ })).not.toBeInTheDocument();
  });

  it("renders the expanded division editor flush after its row", () => {
    useBillStore.getState().addItem({ description: "Pizza", quantity: 1000, unitPriceCents: 5000, totalPriceCents: 5000 });
    const { container } = renderForm("split");
    fireEvent.click(screen.getByRole("button", { name: /Pizza/ }));
    expect(screen.getByText("Pessoas")).toBeInTheDocument();
    expect(container.querySelector(".px-4.pb-4.pt-1")).toBeNull();
  });

  it("returns to Conta and focuses the name field from the review title issue", async () => {
    prepareStore("", true);
    renderForm("review");
    const pendencias = screen.getByLabelText("Pendências");
    const issue = within(pendencias).getByText("Informe o nome da conta").closest("div")!;
    fireEvent.click(within(issue).getByRole("button", { name: "Resolver" }));
    expect(screen.getByRole("tab", { name: "Conta" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Nome" })).toHaveFocus());
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

    fireEvent.click(screen.getByRole("button", { name: /^Alice/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Bob/ }));
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

    const alice = screen.getByRole("button", { name: /^Alice/ });
    expect(alice).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(alice);
    expect(screen.getByRole("button", { name: /^Alice/ })).toHaveAttribute("aria-pressed", "true");
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
