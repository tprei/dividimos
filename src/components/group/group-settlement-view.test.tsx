import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupSettlementView } from "./group-settlement-view";
import { recordSettlement } from "@/lib/sync/mutations";
import type { DebtRow } from "@/lib/ledger/debt-rows";

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const pixModalProps: Array<Record<string, unknown>> = [];

vi.mock("@/components/settlement/pix-qr-modal", () => ({
  PixQrModal: (props: Record<string, unknown>) => {
    pixModalProps.push(props);
    return <div data-testid="pix-modal" />;
  },
}));

vi.mock("@/lib/sync/mutations", () => ({
  recordSettlement: vi.fn(),
}));

const groupId = "g1";
const meId = "user-1";

function row(overrides: Partial<DebtRow>): DebtRow {
  return {
    groupId,
    groupName: "Viagem",
    isDm: false,
    counterpartyKind: "user",
    counterpartyId: "user-2",
    counterpartyName: "Carol Souza",
    counterpartyAvatarUrl: null,
    amountCents: 5000,
    direction: "owes",
    ...overrides,
  };
}

beforeEach(() => {
  pixModalProps.length = 0;
  vi.clearAllMocks();
  vi.mocked(recordSettlement).mockResolvedValue({
    groupId,
    ledgerVersion: 2,
    eventId: 1,
  });
});

describe("GroupSettlementView", () => {
  it("mostra estado liquidado sem dívidas", () => {
    render(<GroupSettlementView groupId={groupId} rows={[]} meId={meId} />);

    expect(screen.getByText("Tudo liquidado!")).toBeInTheDocument();
    expect(screen.queryByTestId("pix-modal")).not.toBeInTheDocument();
  });

  it("mostra dívida ativa com botão de pagamento", () => {
    render(
      <GroupSettlementView
        groupId={groupId}
        rows={[row({ direction: "owes" })]}
        meId={meId}
      />,
    );

    expect(screen.getByText("Você → Carol")).toBeInTheDocument();
    expect(screen.getByText(/Você deve/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pagar via Pix" })).toBeInTheDocument();
    expect(screen.queryByText("Aguardando pagamento")).not.toBeInTheDocument();
  });

  it("abre o PixQrModal em modo pagamento ao clicar em Pagar", async () => {
    render(
      <GroupSettlementView
        groupId={groupId}
        rows={[row({ direction: "owes" })]}
        meId={meId}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Pagar via Pix" }));

    expect(screen.getByTestId("pix-modal")).toBeInTheDocument();
    const props = pixModalProps.at(-1)!;
    expect(props.recipientName).toBe("Carol Souza");
    expect(props.amountCents).toBe(5000);
    expect(props.mode).toBe("pay");
  });

  it("confirma o pagamento via recordSettlement", async () => {
    render(
      <GroupSettlementView
        groupId={groupId}
        rows={[row({ direction: "owes" })]}
        meId={meId}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Pagar via Pix" }));

    const onMarkPaid = pixModalProps.at(-1)!.onMarkPaid as (
      cents: number,
    ) => Promise<void>;
    await waitFor(async () => {
      await onMarkPaid(3000);
      expect(recordSettlement).toHaveBeenCalledWith({
        groupId,
        toUserId: "user-2",
        amountCents: 3000,
      });
    });
  });

  it("mostra cobrança aguardando quando o outro me deve", () => {
    render(
      <GroupSettlementView
        groupId={groupId}
        rows={[row({ direction: "owed" })]}
        meId={meId}
      />,
    );

    expect(screen.getByText("Carol → Você")).toBeInTheDocument();
    expect(screen.getByText(/Você recebe/)).toBeInTheDocument();
    expect(screen.getByText("Aguardando pagamento")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pagar via Pix" }),
    ).not.toBeInTheDocument();
  });

  it("renderiza convidado sem botão de pagamento", () => {
    render(
      <GroupSettlementView
        groupId={groupId}
        rows={[
          row({
            counterpartyKind: "guest",
            counterpartyId: "guest-1",
            counterpartyName: "Bruno Convidado",
          }),
        ]}
        meId={meId}
      />,
    );

    expect(screen.getByText(/Bruno/)).toBeInTheDocument();
    expect(screen.getByText(/Convidado/)).toBeInTheDocument();
    expect(screen.getByText("Participante convidado")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pagar via Pix" }),
    ).not.toBeInTheDocument();
  });
});
