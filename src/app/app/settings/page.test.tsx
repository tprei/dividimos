import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AuthIdentitySnapshot } from "@/hooks/use-auth";
import type { NotificationPreferences, User } from "@/types";

// The mock factories below only read these at call time (during render / when
// the action fires), so reassigning them in each test takes effect on the next
// render without rebuilding the mocks.
let mockAuthSnapshot: AuthIdentitySnapshot = {
  status: "authenticated",
  userId: "user-a",
  generation: 0,
  user: {
    id: "user-a",
    email: "user-a@example.com",
    handle: "user-a",
    name: "Alice",
    pixKeyType: "email",
    pixKeyHint: "",
    onboarded: true,
    createdAt: "",
  },
};

const mockPushState = {
  permission: "granted" as const,
  isSubscribed: true,
  isLoading: false,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
};

const updatePrefsMock = vi.fn<
  (expectedUserId: string, prefs: NotificationPreferences) => Promise<{ error?: string }>
>(async () => ({}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockAuthSnapshot,
}));

vi.mock("@/hooks/use-push-notifications", () => ({
  usePushNotifications: () => mockPushState,
}));

vi.mock("./actions", () => ({
  updateNotificationPreferences: (expectedUserId: string, prefs: NotificationPreferences) =>
    updatePrefsMock(expectedUserId, prefs),
}));

// Deterministic, click-driven switch so the debounce / identity behavior under
// test does not depend on the base-ui event internals in happy-dom.
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean;
    onCheckedChange?: (value: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked ?? false}
      onClick={() => onCheckedChange?.(!(checked ?? false))}
    />
  ),
}));

import SettingsPage from "./page";

function makeUser(id: string, prefs?: NotificationPreferences): User {
  return {
    id,
    email: `${id}@example.com`,
    handle: id,
    name: id,
    pixKeyType: "email",
    pixKeyHint: "",
    onboarded: true,
    createdAt: "",
    notificationPreferences: prefs,
  };
}

function authed(user: User, generation: number): AuthIdentitySnapshot {
  return { status: "authenticated", userId: user.id, generation, user };
}

// Category switches render in CATEGORIES order: expenses, settlements, nudges,
// groups, messages.
const switches = () => screen.getAllByRole("switch");

describe("SettingsPage notification preferences", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updatePrefsMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules one debounced save and passes the user id as the first argument", () => {
    mockAuthSnapshot = authed(
      makeUser("user-a", { expenses: true, settlements: false }),
      0,
    );
    render(<SettingsPage />);

    fireEvent.click(switches()[0]); // expenses: true -> false

    // Debounced — nothing has fired yet.
    expect(updatePrefsMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(499);
    expect(updatePrefsMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(updatePrefsMock).toHaveBeenCalledTimes(1);
    expect(updatePrefsMock).toHaveBeenLastCalledWith("user-a", {
      expenses: false,
      settlements: false,
    });
  });

  it("debounces rapid toggles into a single call carrying the latest state", () => {
    mockAuthSnapshot = authed(
      makeUser("user-a", { expenses: true, settlements: false }),
      0,
    );
    render(<SettingsPage />);

    fireEvent.click(switches()[0]); // expenses -> false
    fireEvent.click(switches()[1]); // settlements -> true

    vi.advanceTimersByTime(500);

    expect(updatePrefsMock).toHaveBeenCalledTimes(1);
    expect(updatePrefsMock).toHaveBeenLastCalledWith("user-a", {
      expenses: false,
      settlements: true,
    });
  });

  it("does not call the action when unmounted before the timer fires", () => {
    mockAuthSnapshot = authed(makeUser("user-a", { expenses: true }), 0);
    const { unmount } = render(<SettingsPage />);

    fireEvent.click(switches()[0]); // schedules the debounced save
    unmount();

    vi.advanceTimersByTime(500);
    expect(updatePrefsMock).not.toHaveBeenCalled();
  });

  it("remounts on identity change, seeds from the new user, and drops the old draft", () => {
    // Account A: expenses enabled. Toggling it schedules a save for A only.
    mockAuthSnapshot = authed(makeUser("user-a", { expenses: true }), 0);
    const { rerender } = render(<SettingsPage />);
    fireEvent.click(switches()[0]); // expenses -> false (A's draft), pending timer

    // Switch to account B: a fresh generation + id. The parent key changes, so
    // the section unmounts (cancelling A's timer) and remounts seeded from B.
    mockAuthSnapshot = authed(makeUser("user-b"), 1);
    rerender(<SettingsPage />);

    vi.advanceTimersByTime(500);
    // A's late timer was cancelled on unmount; nothing was attributed to B.
    expect(updatePrefsMock).not.toHaveBeenCalled();

    // B seeds from its own preferences (no prefs => everything enabled), not
    // from A's draft toggle (which had disabled expenses).
    expect(switches()[0]).toHaveAttribute("aria-checked", "true");

    // B can edit, and its save names B, not the previous account.
    fireEvent.click(switches()[0]); // expenses -> false for B
    vi.advanceTimersByTime(500);
    expect(updatePrefsMock).toHaveBeenCalledTimes(1);
    expect(updatePrefsMock).toHaveBeenLastCalledWith("user-b", {
      expenses: false,
    });
  });
});
