import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupSettlementView } from "./group-settlement-view";
import { recordSettlement } from "@/lib/sync/mutations";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Me } from "@/types/ledger";

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const pixModalProps: Array<Record<string, unknown>> = [];

vi.mock("@/components/settlement/pix-qr-modal", () => ({
  PixQrModal: (props: Record<string, unknown>) => {
    pixModalProps.push(props);
    const onMarkPaid = props.onMarkPaid as (cents: number) => Promise<void>;
    const amountCents = props.amountCents as number;
    return (
      <button
        type="button"
        data-testid="mock-mark-paid"
        onClick={() => void onMarkPaid(amountCents)}
      >
        mock-pay
      </button>
    );
  },
}));

vi.mock("@/lib/sync/mutations", () => ({
  recordSettlement: vi.fn(),
}));

vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));

const me: Me = {
  id: "user-1",
  handle: "tiago",
  name: "Tiago Silva",
  avatarUrl: null,
  email: "tiago@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

const groupId = "g1";
const NBSP = "\u00a0";

function member(userId: string, handle: string, name: string) {
  return {
    groupId,
    userId,
    status: "accepted" as const,
    invitedBy: null,
    acceptedAt: null,
    user: { id: userId, handle, name, avatarUrl: null },
  };
}

function snapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return {
    group: {
      id: groupId,
      kind: "group",
      name: "Churras do Ap 42",
      creatorId: "user-1",
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 7,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      member("user-1", "tiago", "Tiago Silva"),
      member("user-2", "bia", "Bia Costa"),
      member("user-3", "carlos", "Carlos Souza"),
      member("user-4", "dan", "Dan Silva"),
    ],
    balances: [
      { kind: "user", participantId: "user-1", netCents: -8000 },
      { kind: "user", participantId: "user-2", netCents: 2100 },
      { kind: "user", participantId: "user-3", netCents: 14900 },
      { kind: "user", participantId: "user-4", netCents: -9000 },
    ],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 3,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    expenseCount: 3,
    pairwiseEdges: [
      { fromKind: "user", fromId: "user-1", toId: "user-3", amountCents: 7000 },
      { fromKind: "user", fromId: "user-1", toId: "user-2", amountCents: 1000 },
      { fromKind: "user", fromId: "user-4", toId: "user-3", amountCents: 7900 },
      { fromKind: "user", fromId: "user-4", toId: "user-2", amountCents: 1100 },
    ],
    ...overrides,
  };
}

function seed(snapshotValue: GroupSnapshot, meId: string = me.id) {
  useAppStore.setState({
    hydrated: true,
    me: { ...me, id: meId },
    groups: { [groupId]: snapshotValue },
    groupOrder: [groupId],
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
  pixModalProps.length = 0;
  vi.clearAllMocks();
  vi.mocked(recordSettlement).mockResolvedValue({
    groupId,
    ledgerVersion: 8,
    eventId: 4,
  });
});

describe("GroupSettlementView", () => {
  it("shows consolidated totals, segment labels, and the plan counts", () => {
    const value = snapshot();
    seed(value);

    render(<GroupSettlementView groupId={groupId} snapshot={value} meId={me.id} />);

    expect(
      screen.getByRole("img", { name: `Dívida total: −R$${NBSP}170,00` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: `Crédito total: +R$${NBSP}170,00` }),
    ).toBeInTheDocument();
    expect(screen.getByText("4 dívidas → 3 Pix")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: `Dívida de Dan: −R$${NBSP}90,00` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: `Dívida de Tiago: −R$${NBSP}80,00` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: `Crédito de Carlos: +R$${NBSP}149,00` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: `Crédito de Bia: +R$${NBSP}21,00` }),
    ).toBeInTheDocument();
    expect(screen.queryByText("devem")).not.toBeInTheDocument();
    expect(screen.queryByText("recebem")).not.toBeInTheDocument();
  });

  it("renders every transfer row including third-party acertos", () => {
    const value = snapshot();
    seed(value);

    render(<GroupSettlementView groupId={groupId} snapshot={value} meId={me.id} />);

    expect(screen.getByText("Dan → Carlos")).toBeInTheDocument();
    expect(screen.getByText("Tiago → Carlos")).toBeInTheDocument();
    expect(screen.getByText("Tiago → Bia")).toBeInTheDocument();
    expect(screen.getByText("Outro acerto")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Grafo de dívidas" })).toBeInTheDocument();
    expect(screen.getByText("Simplificação · 4 → 3")).toBeInTheDocument();
  });

  it("opens PixQrModal in pay mode only from my payable rows", async () => {
    const user = userEvent.setup();
    const value = snapshot();
    seed(value);

    render(<GroupSettlementView groupId={groupId} snapshot={value} meId={me.id} />);

    expect(screen.getAllByRole("button", { name: /^Você paga/ })).toHaveLength(2);

    await user.click(
      screen.getByRole("button", {
        name: `Você paga: Tiago Silva paga R$${NBSP}59,00 para Carlos Souza`,
      }),
    );

    const modalProps = pixModalProps.at(-1)!;
    expect(modalProps.mode).toBe("pay");
    expect(modalProps.recipientName).toBe("Carlos Souza");
    expect(modalProps.recipientUserId).toBe("user-3");
    expect(modalProps.groupId).toBe(groupId);
    expect(modalProps.amountCents).toBe(5900);

    await user.click(screen.getByTestId("mock-mark-paid"));

    await waitFor(() => {
      expect(recordSettlement).toHaveBeenCalledWith({
        groupId,
        fromUserId: "user-1",
        toUserId: "user-3",
        amountCents: 5900,
      });
    });
  });

  it("opens PixQrModal in collect mode from my receivable rows", async () => {
    const user = userEvent.setup();
    const value = snapshot();
    seed(value, "user-2");

    render(<GroupSettlementView groupId={groupId} snapshot={value} meId="user-2" />);

    expect(screen.getAllByRole("button", { name: /^Cobrar/ })).toHaveLength(1);

    await user.click(
      screen.getByRole("button", {
        name: `Cobrar: Tiago Silva paga R$${NBSP}21,00 para Bia Costa`,
      }),
    );

    const modalProps = pixModalProps.at(-1)!;
    expect(modalProps.mode).toBe("collect");
    expect(modalProps.recipientName).toBe("Tiago Silva");
    expect(modalProps.recipientUserId).toBe("user-2");

    await user.click(screen.getByTestId("mock-mark-paid"));

    await waitFor(() => {
      expect(recordSettlement).toHaveBeenCalledWith({
        groupId,
        fromUserId: "user-1",
        toUserId: "user-2",
        amountCents: 2100,
      });
    });
  });

  it("keeps third-party rows read-only", () => {
    const value = snapshot();
    seed(value);

    render(<GroupSettlementView groupId={groupId} snapshot={value} meId={me.id} />);

    const row = screen.getByLabelText(
      "Outro acerto: Dan Silva paga R$ 90,00 para Carlos Souza",
    );
    expect(row).toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps guest debtor rows read-only with a Convidado badge", () => {
    const guestSnapshot = snapshot({
      members: [
        member("user-3", "carlos", "Carlos Souza"),
        member("user-4", "dan", "Dan Silva"),
      ],
      balances: [
        { kind: "guest", participantId: "guest-1", netCents: -4000 },
        { kind: "user", participantId: "user-3", netCents: 4000 },
      ],
      guests: [{ id: "guest-1", displayName: "Bruno", expenseId: "e1" }],
      pairwiseEdges: [
        { fromKind: "guest", fromId: "guest-1", toId: "user-3", amountCents: 4000 },
      ],
    });
    seed(guestSnapshot, "user-3");

    render(
      <GroupSettlementView groupId={groupId} snapshot={guestSnapshot} meId="user-3" />,
    );

    expect(screen.getByText("Bruno → Carlos")).toBeInTheDocument();
    expect(screen.getByText("Convidado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Cobrar/ })).not.toBeInTheDocument();
    expect(screen.getByText("Outro acerto")).toBeInTheDocument();
  });

  it("selecting a graph edge highlights and announces the matching transfer row", async () => {
    const value = snapshot();
    seed(value);

    const { container } = render(
      <GroupSettlementView groupId={groupId} snapshot={value} meId={me.id} />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: `Dan Silva paga R$${NBSP}90,00 para Carlos Souza`,
      }),
    );
    expect(
      screen.getByText(
        "Transferência selecionada: Dan Silva paga R$ 90,00 para Carlos Souza",
      ),
    ).toBeInTheDocument();
    const row = container.querySelector("#transfer-user-4-user-3");
    expect(row?.className).toContain("bg-primary/5");
  });

  it("shows only the settled state when every balance is zero", () => {
    const settled = snapshot({
      balances: [{ kind: "user", participantId: "user-1", netCents: 0 }],
      pairwiseEdges: [],
    });
    seed(settled);

    render(<GroupSettlementView groupId={groupId} snapshot={settled} meId={me.id} />);

    expect(screen.getByText("Tudo liquidado!")).toBeInTheDocument();
    expect(screen.queryByText("Saldo consolidado")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Grafo de dívidas" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Plano sugerido")).not.toBeInTheDocument();
  });
});
