import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPathname = vi.fn(() => "/app");

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const mockHasUnread = vi.fn(() => false);
const mockMarkViewed = vi.fn();

vi.mock("@/lib/activity-badge", () => ({
  hasUnreadActivity: () => mockHasUnread(),
  markActivityViewed: () => mockMarkViewed(),
}));

vi.mock("@/contexts/user-context", () => ({
  UserProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/pwa/install-prompt", () => ({
  InstallPrompt: () => null,
}));

vi.mock("@/components/shared/logo", () => ({
  Logo: () => <div data-testid="logo" />,
}));

vi.mock("@/hooks/use-keyboard-visible", () => ({
  useKeyboardVisible: () => false,
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

import { haptics } from "@/hooks/use-haptics";
import { AppShell } from "./app-shell";

describe("AppShell header", () => {
  it("renders a search icon linking to /app/search", () => {
    render(<AppShell initialUser={null}><div>content</div></AppShell>);

    const searchLink = document.querySelector('a[href="/app/search"]');
    expect(searchLink).toBeTruthy();
  });
});

describe("AppShell haptics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers tap haptic when a nav tab is clicked", () => {
    render(<AppShell initialUser={null}><div>content</div></AppShell>);

    const homeLink = screen.getByText("Início").closest("a")!;
    fireEvent.click(homeLink);

    expect(haptics.tap).toHaveBeenCalledOnce();
  });

  it("triggers tap haptic when the primary nav button is clicked", () => {
    render(<AppShell initialUser={null}><div>content</div></AppShell>);

    // Primary button has no label text, find by href
    const primaryLink = document.querySelector('a[href="/app/bill/new"]')!;
    fireEvent.click(primaryLink);

    expect(haptics.tap).toHaveBeenCalledOnce();
  });

  it("triggers impact and success haptics on pull-to-refresh", async () => {
    render(<AppShell initialUser={null}><div>content</div></AppShell>);

    const main = document.querySelector("main")!;

    // Each step needs its own act() so React state updates propagate
    act(() => {
      fireEvent.touchStart(main, { touches: [{ clientY: 0 }] });
    });

    act(() => {
      fireEvent.touchMove(main, { touches: [{ clientY: 250 }] });
    });

    await act(async () => {
      fireEvent.touchEnd(main);
      await new Promise((r) => setTimeout(r, 900));
    });

    expect(haptics.impact).toHaveBeenCalledOnce();
    expect(haptics.success).toHaveBeenCalledOnce();
  });

  it("does not trigger haptics when pull distance is below threshold", () => {
    render(<AppShell initialUser={null}><div>content</div></AppShell>);

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue("/app");
    mockHasUnread.mockReturnValue(false);
  });

  it("renders the activity bell link", () => {
    render(<AppShell initialUser={null}><div>content</div></AppShell>);

    const bellLink = screen.getByLabelText("Atividade");
    expect(bellLink).toBeDefined();
    expect(bellLink.getAttribute("href")).toBe("/app/activity");
  });

  it("shows unread badge when there is unread activity", () => {
    mockHasUnread.mockReturnValue(true);
    render(<AppShell initialUser={null}><div>content</div></AppShell>);

    const bellLink = screen.getByLabelText("Atividade");
    const badge = bellLink.querySelector("span");
    expect(badge).not.toBeNull();
  });

  it("hides unread badge when there is no unread activity", () => {
    mockHasUnread.mockReturnValue(false);
    render(<AppShell initialUser={null}><div>content</div></AppShell>);

    const bellLink = screen.getByLabelText("Atividade");
    const badge = bellLink.querySelector("span");
    expect(badge).toBeNull();
  });

  it("marks activity as viewed when on activity page", () => {
    mockPathname.mockReturnValue("/app/activity");
    render(<AppShell initialUser={null}><div>content</div></AppShell>);

    expect(mockMarkViewed).toHaveBeenCalled();
  });

  it("does not mark activity as viewed on other pages", () => {
    mockPathname.mockReturnValue("/app/groups");
    render(<AppShell initialUser={null}><div>content</div></AppShell>);

    expect(mockMarkViewed).not.toHaveBeenCalled();
  });
});
