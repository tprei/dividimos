import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
};
const mockPathname = vi.fn(() => "/app");

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname(),
}));


vi.mock("@/components/pwa/install-prompt", () => ({
  InstallPrompt: () => null,
}));

vi.mock("@/components/shared/logo", () => ({
  Logo: () => <div data-testid="logo" />,
}));

vi.mock("@/components/shared/skeleton", () => ({
  DashboardSkeleton: () => <div data-testid="dashboard-skeleton" />,
}));

const mockKeyboardVisible = vi.fn(() => false);

vi.mock("@/hooks/use-keyboard-visible", () => ({
  useKeyboardVisible: () => mockKeyboardVisible(),
}));

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

const mockRunBootstrap = vi.fn(() => Promise.resolve());
const mockAttachVisibilityRefresh = vi.fn<(onError: (error: unknown) => void) => () => void>(
  () => vi.fn(),
);

vi.mock("@/lib/sync/bootstrap", () => ({
  runBootstrap: () => mockRunBootstrap(),
  attachVisibilityRefresh: (onError: (error: unknown) => void) =>
    mockAttachVisibilityRefresh(onError),
}));

const mockStartRealtime = vi.fn(() => vi.fn());

vi.mock("@/lib/sync/realtime", () => ({
  startRealtime: () => mockStartRealtime(),
}));

const mockAttachAuthListener = vi.fn<
  (onSignedOut: () => void, onError: (error: unknown) => void) => () => void
>(() => vi.fn());

vi.mock("@/lib/sync/auth", () => ({
  attachAuthListener: (cb: () => void, onError: (error: unknown) => void) =>
    mockAttachAuthListener(cb, onError),
}));

import { haptics } from "@/hooks/use-haptics";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { AppShell } from "./app-shell";

const mockMe: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice Test",
  avatarUrl: null,
  email: "alice@example.com",
  pixKeyType: "cpf",
  pixKeyHint: "***.456.789-**",
  onboarded: true,
  notificationPreferences: { expenses: true, settlements: false },
};

describe("AppShell hydration & auth lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue("/app");
    useAppStore.setState({
      hydrated: false,
      me: null,
      groups: {},
      groupOrder: [],
      bootstrapStatus: "idle",
      bootstrapErrorCode: null,
      lastBootstrappedAccountId: null,
    });
  });

  it("renders skeleton before hydration and omits children", () => {
    render(<AppShell><div>content</div></AppShell>);

    expect(screen.getByTestId("dashboard-skeleton")).toBeDefined();
    expect(screen.queryByText("content")).toBeNull();
  });

  it("renders children when hydrated with an onboarded user", () => {
    useAppStore.setState({
      hydrated: true,
      me: mockMe,
      bootstrapStatus: "ready",
      lastBootstrappedAccountId: mockMe.id,
    });

    render(<AppShell><div>content</div></AppShell>);

    expect(screen.getByText("content")).toBeDefined();
    expect(screen.queryByTestId("dashboard-skeleton")).toBeNull();
  });

  it("shows a skeleton, not the app, when no bootstrap succeeded for this account", () => {
    // A persisted profile from a previous account must not unlock the app.
    useAppStore.setState({
      hydrated: true,
      me: mockMe,
      bootstrapStatus: "loading",
      lastBootstrappedAccountId: "someone-else",
    });

    render(<AppShell><div>content</div></AppShell>);

    expect(screen.getByTestId("dashboard-skeleton")).toBeDefined();
    expect(screen.queryByText("content")).toBeNull();
  });

  it("blocks with a retry when the first bootstrap for this account failed", () => {
    useAppStore.setState({
      hydrated: true,
      me: mockMe,
      bootstrapStatus: "error",
      bootstrapErrorCode: "network",
      lastBootstrappedAccountId: null,
    });

    render(<AppShell><div>content</div></AppShell>);

    expect(screen.queryByText("content")).toBeNull();
    expect(screen.getByRole("button", { name: /Tentar novamente/ })).toBeDefined();
  });

  it("keeps known-good data on screen with a retry when a later read fails", () => {
    useAppStore.setState({
      hydrated: true,
      me: mockMe,
      bootstrapStatus: "error",
      bootstrapErrorCode: "network",
      lastBootstrappedAccountId: mockMe.id,
    });

    render(<AppShell><div>content</div></AppShell>);

    expect(screen.getByText("content")).toBeDefined();
    expect(screen.getByRole("button", { name: /Atualizar/ })).toBeDefined();
  });

  it("never routes to onboarding while the profile is unproven", () => {
    useAppStore.setState({
      hydrated: true,
      me: { ...mockMe, onboarded: false },
      bootstrapStatus: "error",
      bootstrapErrorCode: "network",
      lastBootstrappedAccountId: null,
    });

    render(<AppShell><div>content</div></AppShell>);

    expect(mockRouter.replace).not.toHaveBeenCalledWith(
      expect.stringContaining("/auth/onboard"),
    );
  });

  it("redirects to /auth/onboard when hydrated but me.onboarded is false", () => {
    useAppStore.setState({
      hydrated: true,
      me: { ...mockMe, onboarded: false },
      bootstrapStatus: "ready",
      lastBootstrappedAccountId: mockMe.id,
    });

    render(<AppShell><div>content</div></AppShell>);

    // The destination rides along so onboarding can return them to it.
    expect(mockRouter.replace).toHaveBeenCalledWith(
      expect.stringMatching(/^\/auth\/onboard\?next=/),
    );
  });

  it("calls runBootstrap, startRealtime, attachVisibilityRefresh, attachAuthListener on mount", () => {
    render(<AppShell><div>content</div></AppShell>);

    expect(mockRunBootstrap).toHaveBeenCalled();
    expect(mockStartRealtime).toHaveBeenCalled();
    expect(mockAttachVisibilityRefresh).toHaveBeenCalled();
    expect(mockAttachAuthListener).toHaveBeenCalled();
  });

  it("cleans up sync subscriptions on unmount", () => {
    const unsubRealtime = vi.fn();
    const unsubVisibility = vi.fn();
    const unsubAuth = vi.fn();

    mockStartRealtime.mockReturnValue(unsubRealtime);
    mockAttachVisibilityRefresh.mockReturnValue(unsubVisibility);
    mockAttachAuthListener.mockReturnValue(unsubAuth);

    const { unmount } = render(<AppShell><div>content</div></AppShell>);
    unmount();

    expect(unsubRealtime).toHaveBeenCalled();
    expect(unsubVisibility).toHaveBeenCalled();
    expect(unsubAuth).toHaveBeenCalled();
  });
});

describe("AppShell header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue("/app/settings");
    useAppStore.setState({
      hydrated: true,
      me: mockMe,
      bootstrapStatus: "ready",
      lastBootstrappedAccountId: mockMe.id,
    });
  });

  it("renders a search icon linking to /app/search", () => {
    render(<AppShell><div>content</div></AppShell>);

    const searchLink = document.querySelector('a[href="/app/search"]');
    expect(searchLink).toBeTruthy();
  });

  it("calls runBootstrap when header refresh button is clicked", async () => {
    render(<AppShell><div>content</div></AppShell>);

    const refreshButton = document.querySelector("header button")!;
    await act(async () => {
      fireEvent.click(refreshButton);
    });

    expect(mockRunBootstrap).toHaveBeenCalled();
  });

  it("hides the legacy header on screen-header routes", () => {
    mockPathname.mockReturnValue("/app");
    const { rerender } = render(<AppShell><div>content</div></AppShell>);

    expect(document.querySelector('a[href="/app/search"]')).toBeNull();
    expect(screen.queryByTestId("logo")).toBeNull();

    mockPathname.mockReturnValue("/app/groups/abc");
    rerender(<AppShell><div>content</div></AppShell>);

    expect(document.querySelector('a[href="/app/search"]')).toBeNull();
    expect(screen.queryByTestId("logo")).toBeNull();
  });
});

describe("AppShell navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue("/app/settings");
    useAppStore.setState({
      hydrated: true,
      me: mockMe,
      bootstrapStatus: "ready",
      lastBootstrappedAccountId: mockMe.id,
    });
  });

  it("renders Conversas tab linking to /app/conversations", () => {
    render(<AppShell><div>content</div></AppShell>);

    const conversasLink = screen.getByText("Conversas").closest("a")!;
    expect(conversasLink).toBeTruthy();
    expect(conversasLink.getAttribute("href")).toBe("/app/conversations");
  });

  it("does not render Contas tab", () => {
    render(<AppShell><div>content</div></AppShell>);

    expect(screen.queryByText("Contas")).toBeNull();
  });

  it("highlights Conversas tab when on conversations page", () => {
    mockPathname.mockReturnValue("/app/conversations");
    render(<AppShell><div>content</div></AppShell>);

    const label = screen.getByText("Conversas");
    expect(label.className).toContain("text-primary");
  });
});

describe("AppShell haptics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue("/app/settings");
    useAppStore.setState({
      hydrated: true,
      me: mockMe,
      bootstrapStatus: "ready",
      lastBootstrappedAccountId: mockMe.id,
    });
  });

  it("triggers tap haptic when a nav tab is clicked", () => {
    render(<AppShell><div>content</div></AppShell>);

    const homeLink = screen.getByText("Início").closest("a")!;
    fireEvent.click(homeLink);

    expect(haptics.tap).toHaveBeenCalledOnce();
  });

  it("triggers tap haptic when the primary nav button is clicked", () => {
    render(<AppShell><div>content</div></AppShell>);

    const primaryLink = document.querySelector('a[href="/app/bill/new"]')!;
    fireEvent.click(primaryLink);

    expect(haptics.tap).toHaveBeenCalledOnce();
  });

  it("triggers impact and success haptics on pull-to-refresh", async () => {
    render(<AppShell><div>content</div></AppShell>);

    const main = document.querySelector("main")!;

    act(() => {
      fireEvent.touchStart(main, { touches: [{ clientY: 0 }] });
    });

    act(() => {
      fireEvent.touchMove(main, { touches: [{ clientY: 250 }] });
    });

    await act(async () => {
      fireEvent.touchEnd(main);
    });

    expect(haptics.impact).toHaveBeenCalledOnce();
    expect(mockRunBootstrap).toHaveBeenCalled();
    expect(haptics.success).toHaveBeenCalledOnce();
  });

  it("ignores pull gestures that start on a range input", async () => {
    render(
      <AppShell>
        <input type="range" aria-label="Parcela" />
      </AppShell>,
    );

    const main = document.querySelector("main")!;
    const slider = screen.getByRole("slider", { name: "Parcela" });

    act(() => {
      fireEvent.touchStart(slider, { touches: [{ clientY: 0 }] });
    });
    act(() => {
      fireEvent.touchMove(main, { touches: [{ clientY: 250 }] });
    });
    await act(async () => {
      fireEvent.touchEnd(main);
    });

    expect(haptics.impact).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it("ignores pull gestures that start inside a data-no-pull element", async () => {
    render(
      <AppShell>
        <div data-no-pull>
          <span>alça do controle</span>
        </div>
      </AppShell>,
    );

    const main = document.querySelector("main")!;
    const handle = screen.getByText("alça do controle");

    act(() => {
      fireEvent.touchStart(handle, { touches: [{ clientY: 0 }] });
    });
    act(() => {
      fireEvent.touchMove(main, { touches: [{ clientY: 250 }] });
    });
    await act(async () => {
      fireEvent.touchEnd(main);
    });

    expect(haptics.impact).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it("withholds success feedback when the refresh failed", async () => {
    render(<AppShell><div>content</div></AppShell>);
    // Queue the failure after mount so the mount bootstrap does not consume it.
    mockRunBootstrap.mockRejectedValueOnce(new Error("offline"));

    const main = document.querySelector("main")!;

    act(() => {
      fireEvent.touchStart(main, { touches: [{ clientY: 0 }] });
    });
    act(() => {
      fireEvent.touchMove(main, { touches: [{ clientY: 250 }] });
    });
    await act(async () => {
      fireEvent.touchEnd(main);
    });

    // Telling the user their data is current when the read failed is worse
    // than no feedback at all.
    expect(haptics.impact).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it("does not trigger haptics when pull distance is below threshold", () => {
    render(<AppShell><div>content</div></AppShell>);

    const main = document.querySelector("main")!;

    act(() => {
      fireEvent.touchStart(main, { touches: [{ clientY: 0 }] });
    });

    act(() => {
      fireEvent.touchMove(main, { touches: [{ clientY: 50 }] });
    });

    act(() => {
      fireEvent.touchEnd(main);
    });

    expect(haptics.impact).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
  });
});

describe("AppShell activity bell", () => {
  const groupAt = (lastActivityAt: string): GroupSnapshot => ({
    group: {
      id: "g1",
      kind: "group",
      name: "Amigos",
      creatorId: mockMe.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    members: [],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 1,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt,
    expenseCount: 0,
    pairwiseEdges: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue("/app/settings");
    useAppStore.setState({
      hydrated: true,
      me: mockMe,
      bootstrapStatus: "ready",
      lastBootstrappedAccountId: mockMe.id,
      groups: {},
      activityViewedAt: {},
    });
  });

  it("renders the activity bell link", () => {
    render(<AppShell><div>content</div></AppShell>);

    const bellLink = screen.getByLabelText("Atividade");
    expect(bellLink).toBeDefined();
    expect(bellLink.getAttribute("href")).toBe("/app/activity");
  });

  it("shows the badge for activity this account has not seen", () => {
    useAppStore.setState({ groups: { g1: groupAt("2026-02-01T10:00:00.000Z") } });
    render(<AppShell><div>content</div></AppShell>);

    expect(screen.getByLabelText("Atividade").querySelector("span")).not.toBeNull();
  });

  it("hides the badge once this account has seen the newest activity", () => {
    useAppStore.setState({
      groups: { g1: groupAt("2026-02-01T10:00:00.000Z") },
      activityViewedAt: { [mockMe.id]: "2026-02-01T10:00:00.000Z" },
    });
    render(<AppShell><div>content</div></AppShell>);

    expect(screen.getByLabelText("Atividade").querySelector("span")).toBeNull();
  });

  it("does not credit one account with another account's view", () => {
    useAppStore.setState({
      groups: { g1: groupAt("2026-02-01T10:00:00.000Z") },
      activityViewedAt: { "other-account": "2026-02-01T10:00:00.000Z" },
    });
    render(<AppShell><div>content</div></AppShell>);

    expect(screen.getByLabelText("Atividade").querySelector("span")).not.toBeNull();
  });

  it("does not mark activity viewed merely by visiting the route", () => {
    mockPathname.mockReturnValue("/app/activity");
    useAppStore.setState({ groups: { g1: groupAt("2026-02-01T10:00:00.000Z") } });

    render(<AppShell><div>content</div></AppShell>);

    // Only a successful activity read inside the screen records the view.
    expect(useAppStore.getState().activityViewedAt[mockMe.id]).toBeUndefined();
  });
});

describe("AppShell keyboard padding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue("/app/settings");
    useAppStore.setState({
      hydrated: true,
      me: mockMe,
      bootstrapStatus: "ready",
      lastBootstrappedAccountId: mockMe.id,
    });
  });

  it("applies pb-20 padding to main when keyboard is closed", () => {
    mockKeyboardVisible.mockReturnValue(false);
    render(<AppShell><div>content</div></AppShell>);

    const main = document.querySelector("main")!;
    expect(main.className).toContain("pb-20");
  });

  it("removes pb-20 padding from main when keyboard is open", () => {
    mockKeyboardVisible.mockReturnValue(true);
    render(<AppShell><div>content</div></AppShell>);

    const main = document.querySelector("main")!;
    expect(main.className).not.toContain("pb-20");
  });
});
