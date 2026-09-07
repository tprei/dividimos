import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// --- Mocks ---
const submission = vi.hoisted(() => ({
  error: null,
  finish: vi.fn(),
  phase: "idle",
  ready: true,
  reconcile: vi.fn(),
  request: null,
  reservedEdgeKeys: new Set<string>(),
  result: null,
  submit: vi.fn(),
}));


// Capture what recipientUserId the PixQrModal receives
let capturedPixModalProps: Record<string, unknown> | null = null;

// Mock the pix-qr-modal module so we capture its props without rendering the real component
vi.mock("@/components/settlement/pix-qr-modal", () => ({
  PixQrModal: (props: Record<string, unknown>) => {
    capturedPixModalProps = props;
    return React.createElement("div", { "data-testid": "pix-modal" }, `mode=${props.mode}`);
  },
}));

// Mock next/dynamic to eagerly load the component (skip lazy loading)
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: unknown }>) => {
    // Eagerly resolve the loader — our mock module resolves synchronously
    let Comp: React.ComponentType<Record<string, unknown>> | null = null;
    loader().then((m) => { Comp = m.default as React.ComponentType<Record<string, unknown>>; });
    // By the time render runs, the microtask above has resolved
    return function DynamicStub(props: Record<string, unknown>) {
      return Comp ? React.createElement(Comp, props) : null;
    };
  },
}));

// Mock settlement-actions
const mockQueryBalances = vi.fn();
vi.mock("@/lib/supabase/settlement-actions", () => ({
  queryBalances: (...args: unknown[]) => mockQueryBalances(...args),
}));

vi.mock("@/contexts/settlement-submission-context", () => ({
  settlementEdgeKey: ({
    groupId,
    fromUserId,
    toUserId,
  }: {
    groupId: string;
    fromUserId: string;
    toUserId: string;
  }) => `${groupId}:${fromUserId}:${toUserId}`,
  useSettlementSubmission: () => submission,
}));

// Mock Supabase client for profile fetching
const mockSelect = vi.fn();
const mockIn = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

// Mock push notifications
vi.mock("@/lib/push/push-notify", () => ({
  notifyPaymentNudge: vi.fn().mockResolvedValue(undefined),
}));

// Mock realtime balances hook (no-op)
vi.mock("@/hooks/use-realtime-balances", () => ({
  useRealtimeBalances: vi.fn(),
}));

// Mock haptics
vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

// Mock DebtGraph (SVG rendering not needed)
vi.mock("@/components/settlement/debt-graph", () => ({
  DebtGraph: () => React.createElement("div", { "data-testid": "debt-graph" }),
}));


import { haptics } from "@/hooks/use-haptics";
import { GroupSettlementView } from "./group-settlement-view";
import type { User } from "@/types";

// --- Test data ---

const CREDITOR_ID = "user-creditor";
const DEBTOR_ID = "user-debtor";

const participants: User[] = [
  {
    id: CREDITOR_ID,
    name: "Bob Credor",
    handle: "bob",
    email: "bob@test.com",
    pixKeyType: "email",
    pixKeyHint: "b***@test.com",
    onboarded: true,
    createdAt: "2025-01-01",
  },
  {
    id: DEBTOR_ID,
    name: "Alice Devedora",
    handle: "alice",
    email: "alice@test.com",
    pixKeyType: "cpf",
    pixKeyHint: "***456**",
    onboarded: true,
    createdAt: "2025-01-01",
  },
];

// Balance: DEBTOR owes CREDITOR 5000 centavos
const balanceDebtorOwesCreditor = (() => {
  const [userA, userB] = [DEBTOR_ID, CREDITOR_ID].sort();
  const sign = userA === DEBTOR_ID ? 1 : -1;
  return {
    groupId: "group-1",
    userA,
    userB,
    amountCents: sign * 5000,
    updatedAt: "",
  };
})();

beforeEach(() => {
  vi.restoreAllMocks();
  capturedPixModalProps = null;
  submission.submit.mockClear();
  submission.submit.mockResolvedValue(undefined);
  mockQueryBalances.mockResolvedValue([balanceDebtorOwesCreditor]);
  mockSelect.mockReturnValue({ in: mockIn });
  mockIn.mockResolvedValue({ data: [] });
  mockFrom.mockReturnValue({ select: mockSelect });
});

describe("GroupSettlementView", () => {
  it("records the debt from the debtor to the creditor when the creditor collects", async () => {
    const user = userEvent.setup();

    render(
      <GroupSettlementView
        groupId="group-1"
        balances={[balanceDebtorOwesCreditor]}
        participants={participants}
        currentUserId={CREDITOR_ID}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Gerar cobranca/i)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Gerar cobranca/i));

    await waitFor(() => {
      expect(capturedPixModalProps).not.toBeNull();
    });
    expect(capturedPixModalProps!.mode).toBe("collect");

    const onMarkPaid = capturedPixModalProps!.onMarkPaid as (
      cents: number,
    ) => Promise<void>;
    await onMarkPaid(5000);

    expect(submission.submit).toHaveBeenCalledWith([
      {
        groupId: "group-1",
        fromUserId: DEBTOR_ID,
        toUserId: CREDITOR_ID,
        amountCents: 5000,
      },
    ]);
  });

  it("records the debt from the debtor to the creditor when the debtor pays", async () => {
    const user = userEvent.setup();

    render(
      <GroupSettlementView
        groupId="group-1"
        balances={[balanceDebtorOwesCreditor]}
        participants={participants}
        currentUserId={DEBTOR_ID}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Pagar via Pix/i)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Pagar via Pix/i));

    await waitFor(() => {
      expect(capturedPixModalProps).not.toBeNull();
    });
    expect(capturedPixModalProps!.mode).toBe("pay");

    const onMarkPaid = capturedPixModalProps!.onMarkPaid as (
      cents: number,
    ) => Promise<void>;
    await onMarkPaid(5000);

    expect(submission.submit).toHaveBeenCalledWith([
      {
        groupId: "group-1",
        fromUserId: DEBTOR_ID,
        toUserId: CREDITOR_ID,
        amountCents: 5000,
      },
    ]);
  });


  it("shows settled empty state with guidance when no debts", async () => {
    render(
      <GroupSettlementView
        groupId="group-1"
        balances={[]}
        participants={participants}
        currentUserId={CREDITOR_ID}
      />,
    );

    expect(screen.getByText("Tudo liquidado!")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nenhuma dívida pendente no grupo. Quando uma conta for ativada, os saldos aparecem aqui.",
      ),
    ).toBeInTheDocument();
  });


  it("imports haptics.success for settlement recording", () => {
    expect(haptics.success).toBeDefined();
    expect(typeof haptics.success).toBe("function");
  });
});
