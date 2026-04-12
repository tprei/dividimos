import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemSettlementCard } from "./system-settlement-card";
import type { Settlement, UserProfile } from "@/types";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

const fromUser: UserProfile = {
  id: "user-1",
  handle: "bob",
  name: "Bob Santos",
  avatarUrl: undefined,
};

const toUser: UserProfile = {
  id: "user-2",
  handle: "carol",
  name: "Carol Oliveira",
  avatarUrl: undefined,
};

function makeSettlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: "sett-1",
    groupId: "group-1",
    fromUserId: "user-1",
    toUserId: "user-2",
    amountCents: 5000,
    status: "pending",
    createdAt: "2026-04-10T21:00:00Z",
    ...overrides,
  };
}

describe("SystemSettlementCard", () => {
  it("renders from and to user names", () => {
    render(
      <SystemSettlementCard
        settlement={makeSettlement()}
        fromUser={fromUser}
        toUser={toUser}
      />,
    );

    expect(screen.getByText((_, el) =>
      el?.tagName === "P" && !!el.textContent?.includes("Bob") && !!el.textContent?.includes("Carol"),
    )).toBeInTheDocument();
  });

  it("renders formatted amount", () => {
    render(
      <SystemSettlementCard
        settlement={makeSettlement()}
        fromUser={fromUser}
        toUser={toUser}
      />,
    );

    expect(screen.getByText("R$ 50,00")).toBeInTheDocument();
  });

  it("renders date in pt-BR format", () => {
    render(
      <SystemSettlementCard
        settlement={makeSettlement()}
        fromUser={fromUser}
        toUser={toUser}
      />,
    );

    expect(screen.getByText("10/04/2026")).toBeInTheDocument();
  });

  it("shows pending status header and badge", () => {
    render(
      <SystemSettlementCard
        settlement={makeSettlement({ status: "pending" })}
        fromUser={fromUser}
        toUser={toUser}
      />,
    );

    expect(screen.getByText("Pagamento registrado")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
  });

  it("shows confirmed status header and badge", () => {
    render(
      <SystemSettlementCard
        settlement={makeSettlement({ status: "confirmed", confirmedAt: "2026-04-11T10:00:00Z" })}
        fromUser={fromUser}
        toUser={toUser}
      />,
    );

    expect(screen.getByText("Pagamento confirmado")).toBeInTheDocument();
    expect(screen.getByText("Confirmado")).toBeInTheDocument();
  });

  it("renders from user avatar", () => {
    render(
      <SystemSettlementCard
        settlement={makeSettlement()}
        fromUser={fromUser}
        toUser={toUser}
      />,
    );

    expect(screen.getByText("BS")).toBeInTheDocument();
  });
});
