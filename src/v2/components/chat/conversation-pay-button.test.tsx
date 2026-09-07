import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationPayButton } from "./conversation-pay-button";
import type { DebtRow } from "@/lib/ledger/debt-rows";

const mutations = vi.hoisted(() => ({
  recordSettlement: vi.fn().mockResolvedValue({ eventId: 1 }),
}));
vi.mock("@/lib/sync/mutations", () => mutations);

const pixModalProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@/components/settlement/pix-qr-modal", () => ({
  PixQrModal: (props: Record<string, unknown>) => {
    pixModalProps.current = props;
    return (
      <div data-testid="pix-modal">
        <button
          onClick={() => {
            const onMarkPaid = props.onMarkPaid as (cents: number) => Promise<void>;
            void onMarkPaid(props.amountCents as number);
          }}
          data-testid="pix-confirm"
        >
          Confirm
        </button>
      </div>
    );
  },
}));

function makeDebtRow(direction: "owes" | "owed", amountCents: number): DebtRow {
  return {
    groupId: "g-1",
    groupName: "Bob Silva",
    isDm: true,
    counterpartyKind: "user",
    counterpartyId: "user-bob",
    counterpartyName: "Bob Silva",
    counterpartyAvatarUrl: null,
    amountCents,
    direction,
  };
}

describe("ConversationPayButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pixModalProps.current = null;
  });

  it("renders null when balance is zero", () => {
    const { container } = render(
      <ConversationPayButton
        groupId="g-1"
        meId="user-me"
        counterpartyId="user-bob"
        counterpartyName="Bob Silva"
        rows={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Pagar button when user owes counterparty", () => {
    render(
      <ConversationPayButton
        groupId="g-1"
        meId="user-me"
        counterpartyId="user-bob"
        counterpartyName="Bob Silva"
        rows={[makeDebtRow("owes", 5000)]}
      />,
    );
    expect(screen.getByText(/Pagar R\$\s*50,00/)).toBeDefined();
  });

  it("renders Cobrar button when counterparty owes user", () => {
    render(
      <ConversationPayButton
        groupId="g-1"
        meId="user-me"
        counterpartyId="user-bob"
        counterpartyName="Bob Silva"
        rows={[makeDebtRow("owed", 3000)]}
      />,
    );
    expect(screen.getByText(/Cobrar R\$\s*30,00/)).toBeDefined();
  });

  it("opens modal and marks payment on confirm", async () => {
    render(
      <ConversationPayButton
        groupId="g-1"
        meId="user-me"
        counterpartyId="user-bob"
        counterpartyName="Bob Silva"
        rows={[makeDebtRow("owes", 5000)]}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    const modal = await screen.findByTestId("pix-modal");
    expect(modal).toBeDefined();
    expect(pixModalProps.current?.amountCents).toBe(5000);
    expect(pixModalProps.current?.mode).toBe("pay");

    fireEvent.click(screen.getByTestId("pix-confirm"));

    expect(mutations.recordSettlement).toHaveBeenCalledWith({
      groupId: "g-1",
      toUserId: "user-bob",
      amountCents: 5000,
    });
  });
});
