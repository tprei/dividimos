import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQueryBalances = vi.fn();
const mockQuerySettlements = vi.fn();
vi.mock("@/lib/supabase/settlement-actions", () => ({
  queryBalances: (...args: unknown[]) => mockQueryBalances(...args),
  querySettlements: (...args: unknown[]) => mockQuerySettlements(...args),
}));

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: (...args: unknown[]) => mockFrom(...args) }),
}));

import { loadGroupFinances } from "./group-finances";
import type { User } from "@/types";

const knownParticipant: User = {
  id: "user-known",
  name: "Known",
  handle: "known",
  email: "",
  pixKeyType: "email",
  pixKeyHint: "",
  onboarded: true,
  createdAt: "",
};

function balanceOf(userA: string, userB: string, amountCents: number) {
  return {
    groupId: "group-1",
    userA: userA < userB ? userA : userB,
    userB: userA < userB ? userB : userA,
    amountCents: userA < userB ? amountCents : -amountCents,
    updatedAt: "",
  };
}

describe("loadGroupFinances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuerySettlements.mockResolvedValue([]);
  });

  it("resolves a balance-only outsider's profile", async () => {
    mockQueryBalances.mockResolvedValue([balanceOf("user-outsider", "user-known", 3000)]);
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({
          data: [{ id: "user-outsider", handle: "outsider", name: "Carlos Externo", avatar_url: null }],
        }),
      }),
    });

    const result = await loadGroupFinances({
      groupId: "group-1",
      knownParticipants: [knownParticipant],
    });

    const outsider = result.participants.find((p) => p.id === "user-outsider");
    expect(outsider?.name).toBe("Carlos Externo");
    expect(mockFrom).toHaveBeenCalledWith("user_profiles");
  });

  it("falls back to 'Membro removido' when a profile cannot be fetched", async () => {
    mockQueryBalances.mockResolvedValue([balanceOf("user-ghost", "user-known", 2000)]);
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: [] }),
      }),
    });

    const result = await loadGroupFinances({
      groupId: "group-1",
      knownParticipants: [knownParticipant],
    });

    const ghost = result.participants.find((p) => p.id === "user-ghost");
    expect(ghost?.name).toBe("Membro removido");
    expect(ghost?.onboarded).toBe(false);
  });

  it("does not fetch profiles when all balance users are already known", async () => {
    mockQueryBalances.mockResolvedValue([balanceOf("user-known", "user-known-2", 1000)]);
    const second: User = { ...knownParticipant, id: "user-known-2", name: "Second" };

    await loadGroupFinances({
      groupId: "group-1",
      knownParticipants: [knownParticipant, second],
    });

    expect(mockFrom).not.toHaveBeenCalled();
  });
});
