import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserProvider, useUser } from "./user-context";

type AuthCallback = (event: string, session: { user: { id: string } } | null) => void;

let authCallback: AuthCallback;
const unsubscribe = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe } } };
      },
    },
    from: () => ({
      select: (...args: unknown[]) => {
        mockSelect(...args);
        return {
          eq: (...eqArgs: unknown[]) => {
            mockEq(...eqArgs);
            return {
              single: () => {
                mockSingle();
                return {
                  data: {
                    id: "user-123",
                    email: "alice@test.com",
                    handle: "alice",
                    name: "Alice",
                    pix_key_type: "email",
                    pix_key_hint: "a***@test.com",
                    avatar_url: null,
                    onboarded: true,
                    created_at: "2025-01-01T00:00:00Z",
                    notification_preferences: {},
                  },
                };
              },
            };
          },
        };
      },
    }),
  }),
}));

function UserDisplay() {
  const user = useUser();
  return <div data-testid="user">{user ? user.handle : "none"}</div>;
}

describe("UserProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders initialUser without fetching", () => {
    render(
      <UserProvider initialUser={{ id: "u1", email: "b@b.com", handle: "bob", name: "Bob", pixKeyType: "email", pixKeyHint: "b***@b.com", onboarded: true, createdAt: "", notificationPreferences: {} }}>
        <UserDisplay />
      </UserProvider>,
    );
    expect(screen.getByTestId("user").textContent).toBe("bob");
    expect(mockSingle).not.toHaveBeenCalled();
  });

  it("fetches profile on SIGNED_IN using session user id (no getUser call)", async () => {
    render(
      <UserProvider initialUser={null}>
        <UserDisplay />
      </UserProvider>,
    );

    expect(screen.getByTestId("user").textContent).toBe("none");

    await act(async () => {
      authCallback("SIGNED_IN", { user: { id: "user-123" } });
    });

    expect(mockEq).toHaveBeenCalledWith("id", "user-123");
    expect(screen.getByTestId("user").textContent).toBe("alice");
  });

  it("skips duplicate SIGNED_IN for same user id", async () => {
    render(
      <UserProvider initialUser={null}>
        <UserDisplay />
      </UserProvider>,
    );

    await act(async () => {
      authCallback("SIGNED_IN", { user: { id: "user-123" } });
    });
    expect(mockSingle).toHaveBeenCalledTimes(1);

    await act(async () => {
      authCallback("SIGNED_IN", { user: { id: "user-123" } });
    });
    expect(mockSingle).toHaveBeenCalledTimes(1);
  });

  it("clears user on SIGNED_OUT", async () => {
    render(
      <UserProvider initialUser={{ id: "u1", email: "b@b.com", handle: "bob", name: "Bob", pixKeyType: "email", pixKeyHint: "b***@b.com", onboarded: true, createdAt: "", notificationPreferences: {} }}>
        <UserDisplay />
      </UserProvider>,
    );

    expect(screen.getByTestId("user").textContent).toBe("bob");

    await act(async () => {
      authCallback("SIGNED_OUT", null);
    });

    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  it("ignores TOKEN_REFRESHED events", async () => {
    render(
      <UserProvider initialUser={null}>
        <UserDisplay />
      </UserProvider>,
    );

    await act(async () => {
      authCallback("TOKEN_REFRESHED", { user: { id: "user-123" } });
    });

    expect(mockSingle).not.toHaveBeenCalled();
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  it("ignores SIGNED_IN with no session", async () => {
    render(
      <UserProvider initialUser={null}>
        <UserDisplay />
      </UserProvider>,
    );

    await act(async () => {
      authCallback("SIGNED_IN", null);
    });

    expect(mockSingle).not.toHaveBeenCalled();
  });

  it("fetches new profile when user id changes", async () => {
    render(
      <UserProvider initialUser={null}>
        <UserDisplay />
      </UserProvider>,
    );

    await act(async () => {
      authCallback("SIGNED_IN", { user: { id: "user-123" } });
    });
    expect(mockSingle).toHaveBeenCalledTimes(1);

    await act(async () => {
      authCallback("SIGNED_IN", { user: { id: "user-456" } });
    });
    expect(mockSingle).toHaveBeenCalledTimes(2);
    expect(mockEq).toHaveBeenLastCalledWith("id", "user-456");
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = render(
      <UserProvider initialUser={null}>
        <UserDisplay />
      </UserProvider>,
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
