import { describe, expect, it } from "vitest";
import { describeVersion } from "./change-summary-copy";
import type { ExpenseVersion } from "@/types/ledger";

const nameOf = (id: string) =>
  ({ "u1": "Alice", "u2": "Bruno", "u3": "Carol Souza" })[id] ?? "Alguém";

function version(overrides: Partial<ExpenseVersion> = {}): ExpenseVersion {
  return {
    expenseId: "e1",
    versionNo: 2,
    authorId: "u1",
    createdAt: "2026-09-01T12:00:00Z",
    occurredOn: "2026-09-01",
    title: "Jantar",
    merchantName: null,
    expenseType: "single_amount",
    totalCents: 12000,
    serviceFeeBasisPoints: 0,
    fixedFeeCents: 0,
    payload: {
      items: [],
      participants: [],
      shares: [],
      payers: [],
      itemAssignments: null,
    },
    changeSummary: null,
    ...overrides,
  };
}

describe("describeVersion", () => {
  it("describes the first version as creation", () => {
    const sentences = describeVersion(version({ versionNo: 1 }), {
      authorName: "Alice",
      nameOf,
    });
    expect(sentences).toEqual(["Alice criou a conta"]);
  });

  it("describes a title change", () => {
    const sentences = describeVersion(
      version({ changeSummary: { title: ["Jantar", "Jantar na praia"], totalCents: null, participantsAdded: [], participantsRemoved: [], payersChanged: false } }),
      { authorName: "Alice", nameOf },
    );
    expect(sentences).toEqual([
      "Alice mudou o nome de “Jantar” para “Jantar na praia”",
    ]);
  });

  it("describes a total change with BRL values", () => {
    const sentences = describeVersion(
      version({ changeSummary: { title: null, totalCents: [10000, 12500], participantsAdded: [], participantsRemoved: [], payersChanged: false } }),
      { authorName: "Bruno", nameOf },
    );
    expect(sentences).toEqual(["Bruno mudou o total de R$\u00A0100,00 para R$\u00A0125,00"]);
  });

  it("describes one added participant", () => {
    const sentences = describeVersion(
      version({ changeSummary: { title: null, totalCents: null, participantsAdded: ["u2"], participantsRemoved: [], payersChanged: false } }),
      { authorName: "Alice", nameOf },
    );
    expect(sentences).toEqual(["Alice adicionou Bruno"]);
  });

  it("joins two added participants with e", () => {
    const sentences = describeVersion(
      version({ changeSummary: { title: null, totalCents: null, participantsAdded: ["u2", "u3"], participantsRemoved: [], payersChanged: false } }),
      { authorName: "Alice", nameOf },
    );
    expect(sentences).toEqual(["Alice adicionou Bruno e Carol Souza"]);
  });

  it("joins three added participants with commas and e", () => {
    const sentences = describeVersion(
      version({ changeSummary: { title: null, totalCents: null, participantsAdded: ["u1", "u2", "u3"], participantsRemoved: [], payersChanged: false } }),
      { authorName: "Alice", nameOf },
    );
    expect(sentences).toEqual(["Alice adicionou Alice, Bruno e Carol Souza"]);
  });

  it("falls back to Alguém for unknown participant ids", () => {
    const sentences = describeVersion(
      version({ changeSummary: { title: null, totalCents: null, participantsAdded: ["zz"], participantsRemoved: [], payersChanged: false } }),
      { authorName: "Alice", nameOf },
    );
    expect(sentences).toEqual(["Alice adicionou Alguém"]);
  });

  it("describes removed participants", () => {
    const sentences = describeVersion(
      version({ changeSummary: { title: null, totalCents: null, participantsAdded: [], participantsRemoved: ["u2", "u3"], payersChanged: false } }),
      { authorName: "Carol Souza", nameOf },
    );
    expect(sentences).toEqual(["Carol Souza removeu Bruno e Carol Souza"]);
  });

  it("describes a payer change", () => {
    const sentences = describeVersion(
      version({ changeSummary: { title: null, totalCents: null, participantsAdded: [], participantsRemoved: [], payersChanged: true } }),
      { authorName: "Alice", nameOf },
    );
    expect(sentences).toEqual(["Alice mudou quem pagou"]);
  });

  it("combines multiple changes in order", () => {
    const sentences = describeVersion(
      version({
        changeSummary: {
          title: ["A", "B"],
          totalCents: [100, 200],
          participantsAdded: ["u2"],
          participantsRemoved: ["u3"],
          payersChanged: true,
        },
      }),
      { authorName: "Alice", nameOf },
    );
    expect(sentences).toEqual([
      "Alice mudou o nome de “A” para “B”",
      "Alice mudou o total de R$\u00A01,00 para R$\u00A02,00",
      "Alice adicionou Bruno",
      "Alice removeu Carol Souza",
      "Alice mudou quem pagou",
    ]);
  });

  it("falls back to a generic edit when nothing applies", () => {
    const sentences = describeVersion(
      version({ changeSummary: { title: null, totalCents: null, participantsAdded: [], participantsRemoved: [], payersChanged: false } }),
      { authorName: "Alice", nameOf },
    );
    expect(sentences).toEqual(["Alice editou a conta"]);
  });

  it("falls back to a generic edit when the summary is missing", () => {
    const sentences = describeVersion(version({ changeSummary: null }), {
      authorName: "Alice",
      nameOf,
    });
    expect(sentences).toEqual(["Alice editou a conta"]);
  });
});
