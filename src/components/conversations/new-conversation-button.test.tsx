import React from "react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useUser: () => ({ id: "user-1", name: "Test User" }),
}));

const mockContacts = [
  { id: "u2", handle: "maria", name: "Maria Silva", avatar_url: null },
  { id: "u3", handle: "joao", name: "João Santos", avatar_url: null },
];

let shouldHangDmPairs = true;
let dmPairsResolve: ((v: { data: unknown[] }) => void) | null = null;

function makeChain(result: Promise<{ data: unknown[] }>) {
  const chain = {
    eq: () => makeChain(result),
    neq: () => makeChain(result),
    in: () => makeChain(result),
    or: () => makeChain(result),
    maybeSingle: () => result,
    then: (onf?: (v: unknown) => unknown, onr?: (e: unknown) => unknown) =>
      result.then(onf, onr),
  };
  return chain;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => {
        if (table === "dm_pairs") {
          if (shouldHangDmPairs) {
            return makeChain(
              new Promise<{ data: unknown[] }>((resolve) => {
                dmPairsResolve = resolve;
              }),
            );
          }
          return makeChain(Promise.resolve({ data: [] }));
        }
        if (table === "group_members") {
          return makeChain(
            Promise.resolve({
              data: [{ group_id: "g1", user_id: "u2" }],
            }),
          );
        }
        if (table === "user_profiles") {
          return makeChain(
            Promise.resolve({ data: mockContacts }),
          );
        }
        return makeChain(Promise.resolve({ data: [] }));
      },
    }),
    rpc: () => ({
      maybeSingle: () => Promise.resolve({ data: null }),
    }),
  }),
}));

import { NewConversationButton } from "./new-conversation-button";

describe("NewConversationButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shouldHangDmPairs = true;
    dmPairsResolve = null;
  });

  afterEach(() => {
    cleanup();
    if (dmPairsResolve) {
      dmPairsResolve({ data: [] });
      dmPairsResolve = null;
    }
  });

  it("shows ContactRowSkeleton placeholders while loading known contacts", async () => {
    render(<NewConversationButton />);

    await userEvent.click(
      screen.getByRole("button", { name: "Nova conversa" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Conhecidos")).toBeInTheDocument();
    });

    const section = screen.getByText("Conhecidos").parentElement!;
    const avatarSkeletons = section.querySelectorAll(
      "[class*='rounded-full']",
    );
    expect(avatarSkeletons.length).toBe(3);

    expect(screen.queryByText("Maria Silva")).not.toBeInTheDocument();
    expect(screen.queryByText("Carregando...")).not.toBeInTheDocument();
  });

  it("replaces skeletons with real contacts after loading completes", async () => {
    shouldHangDmPairs = false;

    render(<NewConversationButton />);

    await userEvent.click(
      screen.getByRole("button", { name: "Nova conversa" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    });

    expect(screen.getByText("João Santos")).toBeInTheDocument();
    expect(screen.getByText("@maria")).toBeInTheDocument();
    expect(screen.getByText("@joao")).toBeInTheDocument();
  });
});
