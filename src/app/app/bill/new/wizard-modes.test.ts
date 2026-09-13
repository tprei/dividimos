import { describe, expect, it } from "vitest";
import { parseWizardModes } from "./wizard-modes";

function params(values: Record<string, string>): { get(name: string): string | null } {
  return {
    get(name) {
      return values[name] ?? null;
    },
  };
}

describe("parseWizardModes chat actor fields", () => {
  it("keeps validated participant and payer IDs", () => {
    const result = parseWizardModes(
      params({
        groupId: "group-1",
        title: "Jantar",
        amount: "10000",
        type: "itemized",
        participantIds: "user-me,user-other",
        payerId: "user-other",
      }),
    );

    expect(result.chatDraft).toEqual({
      groupId: "group-1",
      title: "Jantar",
      amountCents: 10000,
      expenseType: "itemized",
      participantIds: ["user-me", "user-other"],
      payerId: "user-other",
    });
  });

  it("rejects incomplete or duplicate actor query values", () => {
    expect(
      parseWizardModes(
        params({
          groupId: "group-1",
          title: "Jantar",
          amount: "10000",
          participantIds: "user-me,user-me",
          payerId: "user-me",
        }),
      ).chatDraft,
    ).toBeNull();

    expect(
      parseWizardModes(
        params({
          groupId: "group-1",
          title: "Jantar",
          amount: "10000",
          participantIds: "user-me,user-other",
        }),
      ).chatDraft,
    ).toBeNull();
  });

  it("preserves old chat draft URLs without actor fields", () => {
    expect(
      parseWizardModes(
        params({ groupId: "group-1", title: "Jantar", amount: "10000" }),
      ).chatDraft,
    ).toEqual({
      groupId: "group-1",
      title: "Jantar",
      amountCents: 10000,
      expenseType: "single_amount",
    });
  });
});
