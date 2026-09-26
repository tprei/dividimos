import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePayerSplit } from "./use-payer-split";

function setup() {
  const actions = {
    setPayerFull: vi.fn(),
    splitPaymentEqually: vi.fn(),
    setPayerAmount: vi.fn(),
    removePayerEntry: vi.fn(),
  };
  const hook = renderHook(
    ({ ids }: { ids: readonly string[] }) =>
      usePayerSplit({
        participantIds: ids,
        totalCents: 1000,
        initialPayers: () => [],
        fallbackId: "me",
        actions,
      }),
    { initialProps: { ids: ["me", "bia"] as readonly string[] } },
  );
  return { ...hook, actions };
}

describe("usePayerSplit", () => {
  it("keeps the screen on the store's payer when a second account holder rejoins", () => {
    const { result, rerender, actions } = setup();

    act(() => result.current.toggle("bia"));
    act(() => result.current.toggle("me"));
    expect(result.current.draft.included).toEqual(["bia"]);

    rerender({ ids: ["me"] });
    expect(actions.setPayerFull).toHaveBeenLastCalledWith("me");

    rerender({ ids: ["me", "bia"] });
    expect(result.current.draft.included).toEqual(["me"]);
    expect(actions.setPayerFull).toHaveBeenLastCalledWith("me");
  });
});
