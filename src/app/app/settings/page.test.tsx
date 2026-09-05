import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { NotificationPreferences } from "@/types";
import type { Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";

const mockPushState = {
  permission: "granted" as const,
  isSubscribed: true,
  isLoading: false,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
};

const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
  }),
}));

const mockSignOut = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/lib/sync/client", () => ({
  getSupabase: () => ({
    auth: {
      signOut: mockSignOut,
    },
  }),
}));

const { updateProfileMock } = vi.hoisted(() => ({
  updateProfileMock: vi.fn(),
}));
vi.mock("@/lib/sync/mutations-group", () => ({
  updateProfile: updateProfileMock,
}));

const mockToastError = vi.fn();
vi.mock("react-hot-toast", () => ({
  default: {
    error: (msg: string) => mockToastError(msg),
    success: vi.fn(),
  },
}));

vi.mock("@/hooks/use-push-notifications", () => ({
  usePushNotifications: () => mockPushState,
}));

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

function makeMe(id: string, prefs?: NotificationPreferences): Me {
  return {
    id,
    email: `${id}@example.com`,
    handle: id,
    name: id,
    avatarUrl: null,
    pixKeyType: "email",
    pixKeyHint: "",
    onboarded: true,
    notificationPreferences: prefs ?? {},
  };
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().reset();
  });

  it("renders skeleton when me is null", () => {
    useAppStore.setState({ hydrated: true, me: null });
    render(<SettingsPage />);

    expect(screen.queryByText("Configurações")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders notification preference switches seeded from me", () => {
    useAppStore.setState({
      hydrated: true,
      me: makeMe("user-a", { expenses: true, settlements: false }),
    });
    render(<SettingsPage />);

    expect(screen.getByText("Configurações")).toBeInTheDocument();
    const sws = screen.getAllByRole("switch");
    expect(sws[0]).toHaveAttribute("aria-checked", "true");
    expect(sws[1]).toHaveAttribute("aria-checked", "false");
  });

  it("optimistically toggles a preference and calls updateProfile", async () => {
    const user = makeMe("user-a", { expenses: true, settlements: false });
    useAppStore.setState({ hydrated: true, me: user });
    render(<SettingsPage />);

    const sws = screen.getAllByRole("switch");
    fireEvent.click(sws[0]);

    await waitFor(() => {
      expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");
    });
    expect(useAppStore.getState().me?.notificationPreferences?.expenses).toBe(false);
    expect(updateProfileMock).toHaveBeenCalledTimes(1);
    expect(updateProfileMock).toHaveBeenCalledWith({
      notificationPreferences: {
        expenses: false,
        settlements: false,
      },
    });
  });

  it("rolls back store state and shows toast on updateProfile failure", async () => {
    updateProfileMock.mockRejectedValueOnce(new Error("Network error"));

    const user = makeMe("user-a", { expenses: true, settlements: false });
    useAppStore.setState({ hydrated: true, me: user });
    render(<SettingsPage />);

    const sws = screen.getAllByRole("switch");
    fireEvent.click(sws[0]);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });

    expect(useAppStore.getState().me?.notificationPreferences?.expenses).toBe(true);
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");
  });

  it("handles sign out by signing out, resetting store, and redirecting", async () => {
    const user = makeMe("user-a");
    useAppStore.setState({ hydrated: true, me: user });
    render(<SettingsPage />);

    const signOutButton = screen.getByRole("button", { name: /sair/i });
    fireEvent.click(signOutButton);

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockRouterReplace).toHaveBeenCalledWith("/auth");
    });
  });

  it("remounts on user change and seeds from new user preferences", () => {
    useAppStore.setState({
      hydrated: true,
      me: makeMe("user-a", { expenses: false }),
    });
    const { rerender } = render(<SettingsPage />);
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");

    useAppStore.setState({
      hydrated: true,
      me: makeMe("user-b", { expenses: true }),
    });
    rerender(<SettingsPage />);
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");
  });
});
