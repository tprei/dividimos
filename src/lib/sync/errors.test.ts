import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEDGER_ERROR_CODES,
  LedgerError,
  codeFromMessage,
  ledgerErrorMessage,
} from "./errors";

describe("errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("network falls back to the offline copy only when the browser reports offline", () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    expect(ledgerErrorMessage(new LedgerError("network"))).toMatch(/sem conexão/i);

    vi.stubGlobal("navigator", { ...navigator, onLine: true });
    expect(ledgerErrorMessage(new LedgerError("network"))).not.toMatch(/sem conexão/i);
  });

  it("every LedgerErrorCode has non-empty copy", () => {
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
    expect(codeFromMessage("guest_already_claimed")).toBe("guest_already_claimed");
    expect(codeFromMessage("group_has_history")).toBe("group_has_history");
    expect(codeFromMessage("invitation_not_accepted")).toBe("invitation_not_accepted");
    expect(codeFromMessage("member_excluded")).toBe("member_excluded");
    expect(codeFromMessage("former_member_balance")).toBe("former_member_balance");
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
