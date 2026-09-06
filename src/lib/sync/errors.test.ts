import { describe, expect, it } from "vitest";
import {
  LEDGER_ERROR_CODES,
  LedgerError,
  codeFromMessage,
  ledgerErrorMessage,
} from "./errors";

describe("errors", () => {
  it("every LedgerErrorCode has non-empty copy", () => {
    expect(LEDGER_ERROR_CODES.length).toBe(45);

    for (const code of LEDGER_ERROR_CODES) {
      const err = new LedgerError(code);
      const copy = ledgerErrorMessage(err);
      expect(copy).toBeTypeOf("string");
      expect(copy.trim().length).toBeGreaterThan(0);
      expect(err.message).toBe(copy);
    }
  });

  it("codeFromMessage maps a known code", () => {
    expect(codeFromMessage("not_a_member")).toBe("not_a_member");
    expect(codeFromMessage("stale_version")).toBe("stale_version");
    expect(codeFromMessage("unauthenticated")).toBe("unauthenticated");
    expect(codeFromMessage("outstanding_balance")).toBe("outstanding_balance");
    expect(codeFromMessage("no_debt")).toBe("no_debt");
    expect(codeFromMessage("nudge_cooldown")).toBe("nudge_cooldown");
  });

  it("codeFromMessage falls back to unknown for arbitrary text", () => {
    expect(codeFromMessage("random message")).toBe("unknown");
    expect(codeFromMessage("NOT_A_MEMBER")).toBe("unknown");
    expect(codeFromMessage("not_a_member ")).toBe("unknown");
    expect(codeFromMessage("")).toBe("unknown");
    expect(codeFromMessage("invalid_code_not_in_list")).toBe("unknown");
  });

  it("ledgerErrorMessage returns unknown copy for non-LedgerError values", () => {
    const defaultCopy = ledgerErrorMessage(new LedgerError("unknown"));
    expect(ledgerErrorMessage(new Error("other error"))).toBe(defaultCopy);
    expect(ledgerErrorMessage("some string")).toBe(defaultCopy);
    expect(ledgerErrorMessage(null)).toBe(defaultCopy);
    expect(ledgerErrorMessage(undefined)).toBe(defaultCopy);
  });
});
