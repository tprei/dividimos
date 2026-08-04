"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { mapOwnerProfileRow } from "@/lib/owner-profile";
import type { User } from "@/types";

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";

export type AuthIdentitySnapshot =
  | { status: "loading"; userId: string | null; generation: number; user: null }
  | {
      status: "authenticated";
      userId: string;
      generation: number;
      user: User;
    }
  | {
      status: "unauthenticated";
      userId: null;
      generation: number;
      user: null;
    }
  | { status: "error"; userId: string; generation: number; user: null };

/**
 * Identifies one profile read. A result may only touch state when all three
 * parts still match the pending request, so a late reply from a superseded
 * account or attempt cannot publish itself.
 */
type ProfileRequestBinding = Readonly<{
  userId: string;
  identityGeneration: number;
  profileRequestGeneration: number;
}>;

type PrivateFields = {
  /** The exact last-observed seed reference, used as the render-time guard. */
  observedInitialUser: User | null;
  authEventObserved: boolean;
  profileRequestGeneration: number;
  request: ProfileRequestBinding | null;
};

type InternalIdentityState = AuthIdentitySnapshot & PrivateFields;

type Action =
  | { type: "INITIAL_USER_CHANGED"; seed: User | null }
  | { type: "AUTH_OBSERVED"; event: string; sessionUserId: string | null }
  | {
      type: "PROFILE_RESULT";
      binding: ProfileRequestBinding;
      data: unknown;
      error: unknown;
    };

function privateOf(state: InternalIdentityState): PrivateFields {
  return {
    observedInitialUser: state.observedInitialUser,
    authEventObserved: state.authEventObserved,
    profileRequestGeneration: state.profileRequestGeneration,
    request: state.request,
  };
}

function withRequest(
  priv: PrivateFields,
  userId: string,
  generation: number,
): PrivateFields {
  const profileRequestGeneration = priv.profileRequestGeneration + 1;
  return {
    ...priv,
    profileRequestGeneration,
    request: { userId, identityGeneration: generation, profileRequestGeneration },
  };
}

function withoutRequest(priv: PrivateFields): PrivateFields {
  return {
    ...priv,
    profileRequestGeneration: priv.profileRequestGeneration + 1,
    request: null,
  };
}

function loadingState(
  priv: PrivateFields,
  userId: string | null,
  generation: number,
): InternalIdentityState {
  return { ...priv, status: "loading", userId, generation, user: null };
}

function authenticatedState(
  priv: PrivateFields,
  userId: string,
  generation: number,
  user: User,
): InternalIdentityState {
  return { ...priv, status: "authenticated", userId, generation, user };
}

function unauthenticatedState(
  priv: PrivateFields,
  generation: number,
): InternalIdentityState {
  return {
    ...priv,
    status: "unauthenticated",
    userId: null,
    generation,
    user: null,
  };
}

function errorState(
  priv: PrivateFields,
  userId: string,
  generation: number,
): InternalIdentityState {
  return { ...priv, status: "error", userId, generation, user: null };
}

function init(seed: User | null): InternalIdentityState {
  const priv: PrivateFields = {
    observedInitialUser: seed,
    authEventObserved: false,
    profileRequestGeneration: 0,
    request: null,
  };
  return seed
    ? authenticatedState(priv, seed.id, 0, seed)
    : loadingState(priv, null, 0);
}

function reducer(
  state: InternalIdentityState,
  action: Action,
): InternalIdentityState {
  switch (action.type) {
    case "INITIAL_USER_CHANGED": {
      const seed = action.seed;
      const priv = { ...privateOf(state), observedInitialUser: seed };

      // A seed carries profile data owned by its own ID; it can never be
      // combined with a different live identity.
      if (seed && seed.id === state.userId) {
        return authenticatedState(
          withoutRequest(priv),
          seed.id,
          state.generation,
          seed,
        );
      }

      // Once auth has been observed, a mismatched seed must not leave the
      // retained identity waiting for an auth event that may never arrive.
      if (state.authEventObserved) {
        return state.userId
          ? loadingState(
              withRequest(priv, state.userId, state.generation),
              state.userId,
              state.generation,
            )
          : unauthenticatedState(withoutRequest(priv), state.generation);
      }

      return loadingState(withoutRequest(priv), state.userId, state.generation);
    }

    case "AUTH_OBSERVED": {
      const { event, sessionUserId } = action;
      const priv = { ...privateOf(state), authEventObserved: true };

      if (sessionUserId === null) {
        const generation =
          state.userId === null ? state.generation : state.generation + 1;
        return unauthenticatedState(withoutRequest(priv), generation);
      }

      if (sessionUserId !== state.userId) {
        const generation = state.generation + 1;
        const seed = state.observedInitialUser;
        if (seed && seed.id === sessionUserId && event !== "USER_UPDATED") {
          return authenticatedState(
            withoutRequest(priv),
            sessionUserId,
            generation,
            seed,
          );
        }
        return loadingState(
          withRequest(priv, sessionUserId, generation),
          sessionUserId,
          generation,
        );
      }

      // Same verified identity: the account epoch must not advance.
      if (event === "USER_UPDATED" || state.status === "error") {
        return loadingState(
          withRequest(priv, sessionUserId, state.generation),
          sessionUserId,
          state.generation,
        );
      }

      if (state.status === "authenticated" || state.request) {
        return state.authEventObserved
          ? state
          : { ...state, authEventObserved: true };
      }

      const seed = state.observedInitialUser;
      if (seed && seed.id === sessionUserId) {
        return authenticatedState(
          withoutRequest(priv),
          sessionUserId,
          state.generation,
          seed,
        );
      }
      return loadingState(
        withRequest(priv, sessionUserId, state.generation),
        sessionUserId,
        state.generation,
      );
    }

    case "PROFILE_RESULT": {
      const current = state.request;
      const { binding, data, error } = action;

      if (
        !current ||
        current.userId !== binding.userId ||
        current.identityGeneration !== binding.identityGeneration ||
        current.profileRequestGeneration !== binding.profileRequestGeneration
      ) {
        return state;
      }

      const priv = { ...privateOf(state), request: null };

      // An error decides the attempt before any row is examined: a related
      // account's row can otherwise arrive alongside one.
      if (error) return errorState(priv, binding.userId, state.generation);
      if (!Array.isArray(data) || data.length !== 1) {
        return errorState(priv, binding.userId, state.generation);
      }

      const profile = mapOwnerProfileRow(data[0]);
      if (!profile || profile.id !== binding.userId) {
        return errorState(priv, binding.userId, state.generation);
      }

      return authenticatedState(
        priv,
        binding.userId,
        state.generation,
        profile,
      );
    }
  }
}

const AuthContext = createContext<AuthIdentitySnapshot>({
  status: "loading",
  userId: null,
  generation: 0,
  user: null,
});

export function UserProvider({
  initialUser,
  children,
}: {
  initialUser: User | null;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, initialUser, init);

  // Reconcile a changed server seed during render. A passive effect would let
  // children commit once with the previous account's profile still visible.
  if (state.observedInitialUser !== initialUser) {
    dispatch({ type: "INITIAL_USER_CHANGED", seed: initialUser });
  }

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      dispatch({
        type: "AUTH_OBSERVED",
        event,
        sessionUserId: session?.user?.id ?? null,
      });
    });
    return () => subscription.unsubscribe();
  }, []);

  const request = state.request;
  useEffect(() => {
    if (!request) return;
    let disposed = false;
    const supabase = createClient();

    void supabase.rpc("get_my_profile").then(
      ({ data, error }) => {
        if (!disposed) {
          dispatch({ type: "PROFILE_RESULT", binding: request, data, error });
        }
      },
      (error: unknown) => {
        if (!disposed) {
          dispatch({
            type: "PROFILE_RESULT",
            binding: request,
            data: null,
            error,
          });
        }
      },
    );

    return () => {
      disposed = true;
    };
  }, [request]);

  const { status, userId, generation, user } = state;
  const value = useMemo(
    // The reducer constructors are the only writers of these four fields and
    // always set them together as one of the four legal combinations.
    () => ({ status, userId, generation, user }) as AuthIdentitySnapshot,
    [status, userId, generation, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthIdentitySnapshot {
  return useContext(AuthContext);
}

export function useUser(): User | null {
  return useContext(AuthContext).user;
}
