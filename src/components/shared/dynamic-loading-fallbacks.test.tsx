import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

/**
 * Verify that dynamic imports across the app pass a `loading` option
 * so users see a skeleton fallback while the chunk downloads.
 *
 * Strategy: mock `next/dynamic` to capture the options object, then
 * import each module that calls `dynamic()` and assert the loading
 * function renders a ModalLoadingSkeleton.
 */

let capturedOptions: Array<{ loading?: () => React.ReactNode }> = [];

vi.mock("next/dynamic", () => ({
  default: (_loader: unknown, options?: { loading?: () => React.ReactNode }) => {
    if (options) capturedOptions.push(options);
    // Return a no-op component
    return () => null;
  },
}));

// Stub dependencies so modules can be imported without side effects
vi.mock("@/lib/supabase/settlement-actions", () => ({
  queryBalancesBetweenUsers: vi.fn(),
  queryBalances: vi.fn(),
  recordSettlement: vi.fn(),
}));
vi.mock("@/lib/supabase/expense-actions", () => ({ loadExpense: vi.fn() }));
vi.mock("@/lib/supabase/expense-rpc", () => ({ activateExpense: vi.fn() }));
vi.mock("@/lib/push/push-notify", () => ({
  notifySettlementRecorded: vi.fn().mockResolvedValue(undefined),
  notifyExpenseActivated: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Test", email: "t@t.com", handle: "test" } }),
  useUser: () => ({ id: "u1", name: "Test", email: "t@t.com", handle: "test", avatarUrl: null }),
}));
vi.mock("@/hooks/use-haptics", () => ({
  haptics: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/hooks/use-realtime-expense", () => ({ useRealtimeExpense: vi.fn() }));
vi.mock("@/hooks/use-realtime-balances", () => ({ useRealtimeBalances: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase/debt-actions", () => ({ fetchUserDebts: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

describe("Dynamic import loading fallbacks", () => {
  beforeEach(() => {
    capturedOptions = [];
  });

  it("conversation-pay-button passes loading to both dynamic imports", async () => {
    await import("@/components/chat/conversation-pay-button");
    // Two dynamic imports: PixQrModal and GroupSettlementSheet
    expect(capturedOptions.length).toBeGreaterThanOrEqual(2);
    for (const opts of capturedOptions) {
      expect(opts.loading).toBeTypeOf("function");
      const { container } = render(React.createElement(opts.loading as React.FC));
      expect(container.querySelector("[class*='animate-spin']")).toBeTruthy();
    }
  });

  it("dashboard-content passes loading to PixQrModal dynamic import", async () => {
    capturedOptions = [];
    await import("@/components/dashboard/dashboard-content");
    expect(capturedOptions.length).toBeGreaterThanOrEqual(1);
    const opts = capturedOptions[0];
    expect(opts.loading).toBeTypeOf("function");
    const { container } = render(React.createElement(opts.loading as React.FC));
    expect(container.querySelector("[class*='animate-spin']")).toBeTruthy();
  });

  it("group-settlement-view passes loading to PixQrModal dynamic import", async () => {
    capturedOptions = [];
    await import("@/components/group/group-settlement-view");
    expect(capturedOptions.length).toBeGreaterThanOrEqual(1);
    const opts = capturedOptions[0];
    expect(opts.loading).toBeTypeOf("function");
    const { container } = render(React.createElement(opts.loading as React.FC));
    expect(container.querySelector("[class*='animate-spin']")).toBeTruthy();
  });

  it("bill detail page passes loading to PixQrModal dynamic import", async () => {
    capturedOptions = [];
    await import("@/app/app/bill/[id]/page");
    expect(capturedOptions.length).toBeGreaterThanOrEqual(1);
    const opts = capturedOptions[0];
    expect(opts.loading).toBeTypeOf("function");
    const { container } = render(React.createElement(opts.loading as React.FC));
    expect(container.querySelector("[class*='animate-spin']")).toBeTruthy();
  });
});
