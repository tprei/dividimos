import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { buildExpensePayload } from "@/lib/ledger/payload";
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

function renderForm(submit = vi.fn().mockResolvedValue(false)) {
  return {
    submit,
    ...render(
      <SingleBillForm
        me={me}
        groups={[]}
        initialGroupId={null}
        isDmMode={false}
        isEditing={false}
        hasContactPicker={false}
        onPickContacts={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
        submit={submit}
        submitting={false}
      />,
    ),
  };
}

function goToDivision() {
  fireEvent.click(screen.getByRole("tab", { name: "Divisão" }));
}

beforeEach(() => {
  useBillStore.getState().reset();
  useBillStore.setState({ currentUser: null });
  prepareStore();
  createGroupMock.mockReset();
  getOrCreateDmMock.mockReset();
  getOrCreateDmMock.mockResolvedValue({ groupId: "dm-1" });
  createGroupMock.mockResolvedValue({ groupId: "group-1" });
});

describe("SingleBillForm division", () => {
  it("blocks percent submit until the exact 100,00% total and updates the status", async () => {
    renderForm();
    goToDivision();
    fireEvent.click(screen.getByRole("radio", { name: "Percentual" }));

    const aliceInput = screen.getByRole("textbox", { name: "Percentual de Alice Silva" });
    const bobInput = screen.getByRole("textbox", { name: "Percentual de Bob Santos" });
    fireEvent.change(aliceInput, { target: { value: "49" } });

    await waitFor(() => expect(screen.getByText("falta 1,00%")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Criar conta" })).toBeDisabled();

    fireEvent.change(bobInput, { target: { value: "51" } });
    await waitFor(() => expect(screen.queryByText("falta 1,00%")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Alice/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Criar conta" })).toBeEnabled());
  });

  it("blocks fixed submit until the values equal the total", async () => {
    renderForm();
    goToDivision();
    fireEvent.click(screen.getByRole("radio", { name: "Fixo" }));

    const aliceInput = screen.getByRole("textbox", { name: "Valor de Alice Silva" });
    const bobInput = screen.getByRole("textbox", { name: "Valor de Bob Santos" });
    fireEvent.change(aliceInput, { target: { value: "60" } });

    await waitFor(() => expect(screen.getByText(/excede R\$\s*10,00/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Criar conta" })).toBeDisabled();

    fireEvent.change(bobInput, { target: { value: "40" } });
    await waitFor(() => expect(screen.queryByText(/excede R\$\s*10,00/)).not.toBeInTheDocument());
  });

  it("preserves the authored mode and values when submit fails", async () => {
    const submit = vi.fn().mockResolvedValue(false);
    renderForm(submit);
    goToDivision();
    fireEvent.click(screen.getByRole("radio", { name: "Percentual" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Percentual de Alice Silva" }), {
      target: { value: "60" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Percentual de Bob Santos" }), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Alice/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Criar conta" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    await expect(submit.mock.calls[0][0]()).resolves.toBe("dm-1");
    expect(screen.getByRole("radio", { name: "Percentual" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "Percentual de Alice Silva" })).toHaveValue("60");
    expect(screen.getByRole("textbox", { name: "Percentual de Bob Santos" })).toHaveValue("40");
  });

  it("builds a payload from the same shares rendered in the summary", async () => {
    renderForm();
    goToDivision();
    fireEvent.click(screen.getByRole("button", { name: /Alice/ }));
    await waitFor(() => expect(useBillStore.getState().billSplits).toHaveLength(2));

    const state = useBillStore.getState();
    const result = buildExpensePayload(state, "2026-09-10");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payload.shares).toEqual(
      state.billSplits.map((split) => split.computedAmountCents),
    );
    expect(screen.getAllByText(/R\$\s*50,00/)).toHaveLength(2);
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

    expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveTextContent(
      "Viagem",
    );
    goToDivision();
    fireEvent.click(screen.getByRole("button", { name: /Alice/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Criar conta" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    await expect(submit.mock.calls[0][0]()).resolves.toBe("g-late");
    expect(getOrCreateDmMock).not.toHaveBeenCalled();
    expect(createGroupMock).not.toHaveBeenCalled();
  });

  it("keeps typed percent values when switching stages", () => {
    renderForm();
    goToDivision();
    fireEvent.click(screen.getByRole("radio", { name: "Percentual" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Percentual de Alice Silva" }), {
      target: { value: "33" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Conta" }));
    expect(screen.getByRole("combobox", { name: "Grupo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Divisão" }));
    expect(screen.getByRole("radio", { name: "Percentual" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "Percentual de Alice Silva" })).toHaveValue("33");
  });
});
