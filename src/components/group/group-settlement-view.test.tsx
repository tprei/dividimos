import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// --- Mocks ---

// Capture what recipientUserId the PixQrModal receives
let capturedPixModalProps: Record<string, unknown> | null = null;

// Mock the pix-qr-modal module so we capture its props without rendering the real component
vi.mock("@/components/settlement/pix-qr-modal", () => ({
  PixQrModal: (props: Record<string, unknown>) => {
    capturedPixModalProps = props;
    return React.createElement("div", { "data-testid": "pix-modal" }, `recipientUserId=${props.recipientUserId}`);
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
  recordSettlement: vi.fn(),
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
  notifySettlementRecorded: vi.fn().mockResolvedValue(undefined),
}));

// Mock realtime balances hook (no-op)
vi.mock("@/hooks/use-realtime-balances", () => ({
  useRealtimeBalances: vi.fn(),
}));

// Mock DebtGraph (SVG rendering not needed) — capture props
let capturedDebtGraphProps: Record<string, unknown> | null = null;
vi.mock("@/components/settlement/debt-graph", () => ({
  DebtGraph: (props: Record<string, unknown>) => {
    capturedDebtGraphProps = props;
    return React.createElement("div", { "data-testid": "debt-graph" });
  },
}));

// Mock SimplificationViewer
vi.mock("@/components/settlement/simplification-viewer", () => ({
  SimplificationViewer: () => null,
}));

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
  };
})();

beforeEach(() => {
  vi.restoreAllMocks();
  capturedPixModalProps = null;
  capturedDebtGraphProps = null;
  mockQueryBalances.mockResolvedValue([balanceDebtorOwesCreditor]);
  mockSelect.mockReturnValue({ in: mockIn });
  mockIn.mockResolvedValue({ data: [] });
  mockFrom.mockReturnValue({ select: mockSelect });
});

describe("GroupSettlementView", () => {
  it("passes currentUserId as recipientUserId in collect mode (creditor generates QR)", async () => {
    const user = userEvent.setup();

    render(
      <GroupSettlementView
        groupId="group-1"
        participants={participants}
        currentUserId={CREDITOR_ID}
      />,
    );

    // Wait for balances to load and debt cards to render
    await waitFor(() => {
      expect(screen.getByText(/Gerar cobranca/i)).toBeInTheDocument();
    });

    // Click "Gerar cobranca" — creditor collecting from debtor
    await user.click(screen.getByText(/Gerar cobranca/i));

    // The PixQrModal should receive the creditor's own ID as recipientUserId
    await waitFor(() => {
      expect(capturedPixModalProps).not.toBeNull();
    });

    expect(capturedPixModalProps!.recipientUserId).toBe(CREDITOR_ID);
    expect(capturedPixModalProps!.mode).toBe("collect");
  });

  it("passes creditor's ID as recipientUserId in pay mode (debtor pays)", async () => {
    const user = userEvent.setup();

    render(
      <GroupSettlementView
        groupId="group-1"
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

    // In pay mode, recipientUserId should be the creditor (the person being paid)
    expect(capturedPixModalProps!.recipientUserId).toBe(CREDITOR_ID);
    expect(capturedPixModalProps!.mode).toBe("pay");
  });

  it("resolves names for balance users not in participants", async () => {
    const OUTSIDER_ID = "user-outsider";

    // Balance referencing an outsider not in participants
    const [userA, userB] = [OUTSIDER_ID, CREDITOR_ID].sort();
    const sign = userA === OUTSIDER_ID ? 1 : -1;
    mockQueryBalances.mockResolvedValue([{
      groupId: "group-1",
      userA,
      userB,
      amountCents: sign * 3000,
    }]);

    // Mock profile fetch for the missing user
    mockIn.mockResolvedValue({
      data: [{ id: OUTSIDER_ID, handle: "outsider", name: "Carlos Externo", avatar_url: null }],
    });

    render(
      <GroupSettlementView
        groupId="group-1"
        participants={participants}
        currentUserId={CREDITOR_ID}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Carlos/)).toBeInTheDocument();
    });

    // Should have fetched the missing profile
    expect(mockFrom).toHaveBeenCalledWith("user_profiles");
    expect(mockIn).toHaveBeenCalledWith("id", [OUTSIDER_ID]);
  });

  it("passes resolved participants (including balance-only users) to DebtGraph", async () => {
    const OUTSIDER_ID = "user-outsider";

    const [userA, userB] = [OUTSIDER_ID, CREDITOR_ID].sort();
    const sign = userA === OUTSIDER_ID ? 1 : -1;
    mockQueryBalances.mockResolvedValue([{
      groupId: "group-1",
      userA,
      userB,
      amountCents: sign * 3000,
    }]);

    mockIn.mockResolvedValue({
      data: [{ id: OUTSIDER_ID, handle: "outsider", name: "Carlos Externo", avatar_url: null }],
    });

    render(
      <GroupSettlementView
        groupId="group-1"
        participants={participants}
        currentUserId={CREDITOR_ID}
      />,
    );

    await waitFor(() => {
      expect(capturedDebtGraphProps).not.toBeNull();
    });

    const graphParticipants = capturedDebtGraphProps!.participants as User[];
    const ids = graphParticipants.map((p) => p.id);
    expect(ids).toContain(OUTSIDER_ID);
    expect(graphParticipants.find((p) => p.id === OUTSIDER_ID)?.name).toBe("Carlos Externo");
  });

  it("falls back to 'Membro removido' when profile cannot be fetched", async () => {
    const GHOST_ID = "user-ghost";

    const [userA, userB] = [GHOST_ID, CREDITOR_ID].sort();
    const sign = userA === GHOST_ID ? 1 : -1;
    mockQueryBalances.mockResolvedValue([{
      groupId: "group-1",
      userA,
      userB,
      amountCents: sign * 2000,
    }]);

    // Profile fetch returns empty — user no longer exists
    mockIn.mockResolvedValue({ data: [] });

    render(
      <GroupSettlementView
        groupId="group-1"
        participants={participants}
        currentUserId={CREDITOR_ID}
      />,
    );

    // The component renders name.split(" ")[0] — so "Membro" appears
    await waitFor(() => {
      expect(screen.getByText(/Membro/)).toBeInTheDocument();
    });

    // Verify the full name was set on the resolved participant via DebtGraph
    const graphParticipants = capturedDebtGraphProps!.participants as User[];
    const ghost = graphParticipants.find((p) => p.id === GHOST_ID);
    expect(ghost?.name).toBe("Membro removido");
  });
});
