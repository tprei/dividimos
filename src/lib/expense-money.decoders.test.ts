import { describe, expect, it } from "vitest";
import {
  decodeExpenseActivationResult,
  decodeExpenseGraphSaveLookupResult,
  decodeExpenseGraphSaveResult,
} from "./expense-money";

describe("decodeExpenseGraphSaveResult", () => {
  it("decodes a well-formed {id, graph_revision}", () => {
    expect(
      decodeExpenseGraphSaveResult({ id: "00000000-0000-0000-0000-000000000001", graph_revision: 7 }),
    ).toEqual({
      ok: true,
      value: { expenseId: "00000000-0000-0000-0000-000000000001", graphRevision: 7 },
    });
  });

  it("rejects extra/missing keys, non-string id, and bad revisions", () => {
    expect(decodeExpenseGraphSaveResult({ id: "x", graph_revision: 1, extra: 1 }).ok).toBe(false);
    expect(decodeExpenseGraphSaveResult({ id: "x" }).ok).toBe(false);
    expect(decodeExpenseGraphSaveResult({ id: 5, graph_revision: 1 }).ok).toBe(false);
    expect(decodeExpenseGraphSaveResult({ id: "x", graph_revision: -1 }).ok).toBe(false);
    expect(decodeExpenseGraphSaveResult({ id: "x", graph_revision: 1.5 }).ok).toBe(false);
    expect(decodeExpenseGraphSaveResult(null).ok).toBe(false);
  });
});

describe("decodeExpenseGraphSaveLookupResult", () => {
  it("decodes retired and committed arms with exact keys", () => {
    expect(decodeExpenseGraphSaveLookupResult({ outcome: "retired" })).toEqual({
      ok: true,
      value: { outcome: "retired" },
    });
    expect(
      decodeExpenseGraphSaveLookupResult({ outcome: "committed", id: "e1", graph_revision: 3 }),
    ).toEqual({
      ok: true,
      value: { outcome: "committed", expenseId: "e1", graphRevision: 3 },
    });
  });

  it("rejects unknown outcomes, retired with extra keys, and committed with bad fields", () => {
    expect(decodeExpenseGraphSaveLookupResult({ outcome: "pending" }).ok).toBe(false);
    expect(decodeExpenseGraphSaveLookupResult({ outcome: "retired", id: "x" }).ok).toBe(false);
    expect(
      decodeExpenseGraphSaveLookupResult({ outcome: "committed", id: "x" }).ok,
    ).toBe(false);
    expect(
      decodeExpenseGraphSaveLookupResult({ outcome: "committed", id: "x", graph_revision: -1 }).ok,
    ).toBe(false);
  });
});

describe("decodeExpenseActivationResult", () => {
  it("decodes {id, status: 'active', graph_revision}", () => {
    expect(
      decodeExpenseActivationResult({ id: "e1", status: "active", graph_revision: 2 }),
    ).toEqual({
      ok: true,
      value: { expenseId: "e1", status: "active", graphRevision: 2 },
    });
  });

  it("rejects non-active status, missing/extra keys, and bad revisions", () => {
    expect(
      decodeExpenseActivationResult({ id: "e1", status: "draft", graph_revision: 2 }).ok,
    ).toBe(false);
    expect(decodeExpenseActivationResult({ id: "e1", status: "active" }).ok).toBe(false);
    expect(
      decodeExpenseActivationResult({ id: "e1", status: "active", graph_revision: 2, x: 1 }).ok,
    ).toBe(false);
    expect(
      decodeExpenseActivationResult({ id: "e1", status: "active", graph_revision: 2_147_483_648 }).ok,
    ).toBe(false);
  });
});
