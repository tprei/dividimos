import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { NotificationPreferences } from "@/types";
import type { Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mockPushState = {
  permission: "granted" as const,
  isSubscribed: true,
  isLoading: false,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  error: null,
  retry: vi.fn(),
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

function makeServerMerge() {
  return async (input: { notificationPreferences?: NotificationPreferences }) => {
    const current = useAppStore.getState().me;
    const response: Me = {
      ...(current ?? makeMe("user-a")),
      notificationPreferences: {
        ...(current?.notificationPreferences ?? {}),
        ...(input.notificationPreferences ?? {}),
      },
    };
    useAppStore.setState({ me: response });
    return response;
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
});

describe("SettingsPage notification deltas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().reset();
    updateProfileMock.mockImplementation(makeServerMerge());
  });

  it("sends a single-key delta, never the whole preference object", async () => {
    useAppStore.setState({
      hydrated: true,
      me: makeMe("user-a", { expenses: true, settlements: false }),
    });
    render(<SettingsPage />);

    const sws = screen.getAllByRole("switch");
    fireEvent.click(sws[0]);

    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledTimes(1);
    });
    expect(updateProfileMock).toHaveBeenCalledWith({
      notificationPreferences: { expenses: false },
    });
    expect(useAppStore.getState().me?.notificationPreferences?.expenses).toBe(false);
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");
  });

  it("sends two single-key deltas for different categories and neither clobbers the other", async () => {
    const firstDeferred = deferred<Me>();
    updateProfileMock.mockImplementationOnce(() => firstDeferred.promise);
    updateProfileMock.mockImplementation(makeServerMerge());

    useAppStore.setState({ hydrated: true, me: makeMe("user-a") });
    render(<SettingsPage />);

    const sws = screen.getAllByRole("switch");
    fireEvent.click(sws[4]);
    fireEvent.click(screen.getAllByRole("switch")[2]);

    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledTimes(2);
    });
    expect(updateProfileMock.mock.calls[0][0]).toEqual({
      notificationPreferences: { messages: false },
    });
    expect(updateProfileMock.mock.calls[1][0]).toEqual({
      notificationPreferences: { nudges: false },
    });
    expect(useAppStore.getState().me?.notificationPreferences).toMatchObject({
      messages: false,
      nudges: false,
    });

    firstDeferred.resolve(makeMe("user-a", { messages: false }));
    await waitFor(() => {
      expect(useAppStore.getState().me?.notificationPreferences).toMatchObject({
        messages: false,
        nudges: false,
      });
    });
  });

  it("sends a repeated toggle only after the in-flight request settles", async () => {
    const firstDeferred = deferred<Me>();
    updateProfileMock.mockImplementationOnce(() => firstDeferred.promise);
    updateProfileMock.mockImplementation(makeServerMerge());

    useAppStore.setState({ hydrated: true, me: makeMe("user-a") });
    render(<SettingsPage />);

    const sws = screen.getAllByRole("switch");
    fireEvent.click(sws[0]);
    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(useAppStore.getState().me?.notificationPreferences?.expenses).toBe(true);

    firstDeferred.resolve(makeMe("user-a", { expenses: false }));
    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledTimes(2);
    });
    expect(updateProfileMock.mock.calls[1][0]).toEqual({
      notificationPreferences: { expenses: true },
    });
    await waitFor(() => {
      expect(useAppStore.getState().me?.notificationPreferences?.expenses).toBe(true);
    });
  });

  it("restores only the toggled key and shows a toast when the save fails", async () => {
    updateProfileMock.mockRejectedValueOnce(new Error("Network error"));

    useAppStore.setState({
      hydrated: true,
      me: makeMe("user-a", { expenses: true, settlements: false }),
    });
    render(<SettingsPage />);

    const sws = screen.getAllByRole("switch");
    fireEvent.click(sws[0]);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });

    expect(useAppStore.getState().me?.notificationPreferences?.expenses).toBe(true);
    expect(useAppStore.getState().me?.notificationPreferences?.settlements).toBe(false);
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");
  });

  it("keeps a newer optimistic value when a superseded request fails", async () => {
    const firstDeferred = deferred<Me>();
    updateProfileMock.mockImplementationOnce(() => firstDeferred.promise);

    useAppStore.setState({ hydrated: true, me: makeMe("user-a") });
    render(<SettingsPage />);

    const sws = screen.getAllByRole("switch");
    fireEvent.click(sws[0]);
    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getAllByRole("switch")[0]);

    firstDeferred.reject(new Error("Network error"));
    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledTimes(2);
    });
    expect(mockToastError).not.toHaveBeenCalled();
    expect(updateProfileMock.mock.calls[1][0]).toEqual({
      notificationPreferences: { expenses: true },
    });
    await waitFor(() => {
      expect(useAppStore.getState().me?.notificationPreferences?.expenses).toBe(true);
    });
  });

  it("keeps the rollback when the latest of several rapid toggles fails", async () => {
    const firstDeferred = deferred<Me>();
    updateProfileMock.mockImplementationOnce(() => firstDeferred.promise);
    updateProfileMock.mockRejectedValueOnce(new Error("Network error"));

    useAppStore.setState({ hydrated: true, me: makeMe("user-a") });
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("switch")[0]);
    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(useAppStore.getState().me?.notificationPreferences?.expenses).toBe(false);

    firstDeferred.resolve(makeMe("user-a", { expenses: false }));
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(updateProfileMock).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().me?.notificationPreferences?.expenses).toBe(true);
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");
  });
});

describe("SettingsPage account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().reset();
  });

  it("says which category is saving until the write lands", async () => {
    const pending = deferred<Me>();
    updateProfileMock.mockImplementationOnce(() => pending.promise);

    useAppStore.setState({ hydrated: true, me: makeMe("user-a") });
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() => {
      expect(screen.getByText("Salvando...")).toBeInTheDocument();
    });
    // Only the toggled row reports work in flight.
    expect(screen.getAllByText("Salvando...")).toHaveLength(1);

    pending.resolve(makeMe("user-a", { expenses: false }));
    await waitFor(() => {
      expect(screen.queryByText("Salvando...")).not.toBeInTheDocument();
    });
  });

  it("offers a retry on the row whose save failed", async () => {
    updateProfileMock.mockRejectedValueOnce(new Error("offline"));
    updateProfileMock.mockImplementation(makeServerMerge());

    useAppStore.setState({ hydrated: true, me: makeMe("user-a") });
    render(<SettingsPage />);

    fireEvent.click(screen.getAllByRole("switch")[0]);

    const retry = await screen.findByRole("button", {
      name: "Não salvou. Tentar novamente",
    });
    // The failed category reverted, so the switch shows the old value again.
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");

    fireEvent.click(retry);

    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledTimes(2);
    });
    expect(updateProfileMock.mock.calls[1][0]).toEqual({
      notificationPreferences: { expenses: false },
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Não salvou. Tentar novamente" }),
      ).not.toBeInTheDocument();
    });
  });

  it("handles sign out by signing out, resetting store, and redirecting", async () => {
    useAppStore.setState({ hydrated: true, me: makeMe("user-a") });
    render(<SettingsPage />);

    const signOutButton = screen.getByRole("button", { name: /sair/i });
    fireEvent.click(signOutButton);

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockRouterReplace).toHaveBeenCalledWith("/auth");
    });
  });
  it("keeps the settings screen and retries after sign out failure", async () => {
    const user = makeMe("user-a");
    useAppStore.setState({ hydrated: true, me: user });
    mockSignOut
      .mockResolvedValueOnce({ error: new Error("denied") })
      .mockResolvedValueOnce({ error: null });
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: /sair/i }));
    const retryButton = await screen.findByRole("button", { name: /tentar novamente/i });
    await waitFor(() => expect(retryButton).not.toBeDisabled());
    fireEvent.click(retryButton);
    await waitFor(() => {
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
