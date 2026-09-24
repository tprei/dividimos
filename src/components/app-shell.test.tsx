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

vi.mock("@/components/shared/skeleton", () => ({
  DashboardSkeleton: () => <div data-testid="dashboard-skeleton" />,
}));

const mockKeyboardVisible = vi.fn(() => false);

vi.mock("@/hooks/use-app-viewport", () => ({
  useAppViewport: () => ({ keyboardOpen: mockKeyboardVisible() }),
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
import { ScreenHeader } from "@/components/shared/screen-header";

const mockMe: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice Test",
  avatarUrl: null,
  isBot: false,
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
    expect(screen.getByRole("button", { name: /Tentar novamente/ })).toBeDefined();
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

  it("starts the bootstrap and visibility refresh only once the store has hydrated", () => {
    const rehydrate = vi
      .spyOn(useAppStore.persist, "rehydrate")
      .mockReturnValue(new Promise<void>(() => {}));

    render(<AppShell><div>content</div></AppShell>);
    expect(mockRunBootstrap).not.toHaveBeenCalled();
    expect(mockAttachVisibilityRefresh).not.toHaveBeenCalled();

    act(() => {
      useAppStore.setState({ hydrated: true });
    });
    expect(mockRunBootstrap).toHaveBeenCalledTimes(1);
    expect(mockAttachVisibilityRefresh).toHaveBeenCalledTimes(1);
    rehydrate.mockRestore();
  });

  it("cleans up sync subscriptions on unmount", () => {
    useAppStore.setState({ hydrated: true });
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

  it("provides notifications through the route header without duplicate utilities", () => {
    render(<AppShell><ScreenHeader title="Configurações" back /></AppShell>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Notificações/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Atualizar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Configurações" })).not.toBeInTheDocument();
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

    const tab = screen.getByRole("link", { name: /Conversas/ });
    expect(tab).toHaveAttribute("aria-current", "page");
  });

  it("names the center action Nova conta with a visible Nova label", () => {
    render(<AppShell><div>content</div></AppShell>);

    const action = screen.getByRole("link", { name: "Nova conta" });
    expect(action).toBeInTheDocument();
    expect(screen.getByText("Nova")).toBeInTheDocument();
  });


  it("hides navigation bar inside the expense wizard", () => {
    mockPathname.mockReturnValue("/app/bill/new");
    render(<AppShell><div>content</div></AppShell>);

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("renders navigation bar on group screens", () => {
    mockPathname.mockReturnValue("/app/groups/x");
    render(<AppShell><div>content</div></AppShell>);

    expect(screen.getByRole("navigation")).toBeInTheDocument();
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
      // The store is a module singleton: without resetting the activity read,
      // an earlier test's failed load makes refresh fetch activity here too.
      activity: { items: [], oldestId: null, complete: false, read: { status: "idle" }, readIds: [], dismissedIds: [] },
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
    mockPathname.mockReturnValue("/app");
    render(<AppShell><div>content</div></AppShell>);

    const main = document.querySelector("main")!;

    act(() => {
      fireEvent.touchStart(main, { touches: [{ clientY: 0 }] });
    });

    act(() => {
      fireEvent.touchMove(main, { touches: [{ clientY: 250 }] });
    });
    expect(haptics.selectionChanged).toHaveBeenCalledOnce();

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
    mockPathname.mockReturnValue("/app");
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

  it("never refreshes from a pull on an ineligible route", async () => {
    mockPathname.mockReturnValue("/app/settings");
    render(<AppShell><div>content</div></AppShell>);
    mockRunBootstrap.mockClear();

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

    expect(haptics.impact).not.toHaveBeenCalled();
    expect(mockRunBootstrap).not.toHaveBeenCalled();
  });

  it("abandons a pull that turns horizontal", async () => {
    mockPathname.mockReturnValue("/app");
    render(<AppShell><div>content</div></AppShell>);
    mockRunBootstrap.mockClear();

    const main = document.querySelector("main")!;

    act(() => {
      fireEvent.touchStart(main, { touches: [{ clientX: 10, clientY: 0 }] });
    });
    act(() => {
      fireEvent.touchMove(main, { touches: [{ clientX: 300, clientY: 250 }] });
    });
    await act(async () => {
      fireEvent.touchEnd(main);
    });

    expect(haptics.impact).not.toHaveBeenCalled();
    expect(mockRunBootstrap).not.toHaveBeenCalled();
  });

  it("does not trigger haptics when pull distance is below threshold", () => {
    mockPathname.mockReturnValue("/app");
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

  it("renders the unified bell button that opens notifications", () => {
    render(<AppShell><ScreenHeader title="Configurações" /></AppShell>);

    const bell = screen.getByRole("button", { name: /Notificações/ });
    expect(bell).toBeDefined();
    fireEvent.click(bell);
    expect(screen.getByText("Notificações")).toBeDefined();
  });

  it("shows the badge for activity this account has not seen", () => {
    useAppStore.setState({ groups: { g1: groupAt("2026-02-01T10:00:00.000Z") } });
    render(<AppShell><ScreenHeader title="Configurações" /></AppShell>);
    expect(screen.getByRole("button", { name: /atividade nova/ })).toBeInTheDocument();
  });

  it("hides the badge once this account has seen the newest activity", () => {
    useAppStore.setState({
      groups: { g1: groupAt("2026-02-01T10:00:00.000Z") },
      activityViewedAt: { [mockMe.id]: "2026-02-01T10:00:00.000Z" },
    });
    render(<AppShell><ScreenHeader title="Configurações" /></AppShell>);
    expect(screen.queryByRole("button", { name: /atividade nova/ })).not.toBeInTheDocument();
  });

  it("does not credit one account with another account's view", () => {
    useAppStore.setState({
      groups: { g1: groupAt("2026-02-01T10:00:00.000Z") },
      activityViewedAt: { "other-account": "2026-02-01T10:00:00.000Z" },
    });
    render(<AppShell><ScreenHeader title="Configurações" /></AppShell>);
    expect(screen.getByRole("button", { name: /atividade nova/ })).toBeInTheDocument();
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

  it("hides navigation while the keyboard is open and restores it on close", () => {
    mockKeyboardVisible.mockReturnValue(false);
    const { rerender } = render(<AppShell><div>content</div></AppShell>);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    mockKeyboardVisible.mockReturnValue(true);
    rerender(<AppShell><div>content</div></AppShell>);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    mockKeyboardVisible.mockReturnValue(false);
    rerender(<AppShell><div>content</div></AppShell>);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });
});
