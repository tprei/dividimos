import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAuth, useUser, meToLegacyUser } from "./use-auth";
import { useAppStore } from "@/stores/app-store";
import type { Me } from "@/types/ledger";

function createMockMe(overrides: Partial<Me> = {}): Me {
  return {
    id: "user-1",
    handle: "alice",
    name: "Alice Test",
    avatarUrl: "https://example.com/avatar.png",
    email: "alice@example.com",
    pixKeyType: "cpf",
    pixKeyHint: "***.456.789-**",
    onboarded: true,
    notificationPreferences: { expenses: true, settlements: false },
    ...overrides,
  };
}

describe("use-auth adapter", () => {
  beforeEach(() => {
    useAppStore.setState({
      hydrated: false,
      me: null,
    });
  });

  describe("meToLegacyUser", () => {
    it("converts Me to legacy User shape with defaults", () => {
      const me = createMockMe({ pixKeyType: null, pixKeyHint: null, avatarUrl: null });
      const user = meToLegacyUser(me);

      expect(user).toEqual({
        id: "user-1",
        email: "alice@example.com",
        handle: "alice",
        name: "Alice Test",
        pixKeyType: "email",
        pixKeyHint: "",
        avatarUrl: undefined,
        onboarded: true,
        createdAt: "",
        notificationPreferences: { expenses: true, settlements: false },
      });
    });

    it("preserves pixKeyType, pixKeyHint, and avatarUrl when present", () => {
      const me = createMockMe();
      const user = meToLegacyUser(me);

      expect(user.pixKeyType).toBe("cpf");
      expect(user.pixKeyHint).toBe("***.456.789-**");
      expect(user.avatarUrl).toBe("https://example.com/avatar.png");
    });
  });

  describe("useAuth & useUser", () => {
    it("returns loading state when not hydrated", () => {
      useAppStore.setState({ hydrated: false, me: null });

      const { result: authResult } = renderHook(() => useAuth());
      const { result: userResult } = renderHook(() => useUser());

      expect(authResult.current).toEqual({
        status: "loading",
        userId: null,
        generation: 0,
        user: null,
      });
      expect(userResult.current).toBeNull();
    });

    it("returns loading state with userId when not hydrated but me exists in store", () => {
      const me = createMockMe();
      useAppStore.setState({ hydrated: false, me });

      const { result: authResult } = renderHook(() => useAuth());
      const { result: userResult } = renderHook(() => useUser());

      expect(authResult.current).toEqual({
        status: "loading",
        userId: "user-1",
        generation: 0,
        user: null,
      });
      expect(userResult.current).toBeNull();
    });

    it("returns authenticated state when hydrated and me is present", () => {
      const me = createMockMe();
      useAppStore.setState({ hydrated: true, me });

      const { result: authResult } = renderHook(() => useAuth());
      const { result: userResult } = renderHook(() => useUser());

      expect(authResult.current.status).toBe("authenticated");
      expect(authResult.current.userId).toBe("user-1");
      expect(authResult.current.generation).toBe(0);
      expect(authResult.current.user).toEqual(meToLegacyUser(me));
      expect(userResult.current).toEqual(meToLegacyUser(me));
    });

    it("returns unauthenticated state when hydrated and me is null", () => {
      useAppStore.setState({ hydrated: true, me: null });

      const { result: authResult } = renderHook(() => useAuth());
      const { result: userResult } = renderHook(() => useUser());

      expect(authResult.current).toEqual({
        status: "unauthenticated",
        userId: null,
        generation: 0,
        user: null,
      });
      expect(userResult.current).toBeNull();
    });
  });
});
