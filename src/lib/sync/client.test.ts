import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidationResult } from "@/lib/expense-money";
import type { WireIssue } from "@/types/ledger";
import { rpc, rpcVoid } from "./client";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({ rpc: mocks.rpc }),
}));

function acceptAnything(raw: unknown): ValidationResult<unknown, WireIssue> {
  return { ok: true, value: raw };
}

function respondWith(status: number, message: string, code = "42501") {
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { code, message, details: null, hint: null },
    status,
  });
}

describe("rpc failures", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  it.each([
    ["rpc", () => rpc("bootstrap_overview", {}, acceptAnything)],
    ["rpcVoid", () => rpcVoid("bootstrap_overview", {})],
  ])("%s reads a sessionless 401 as unauthenticated", async (_name, call) => {
    respondWith(401, "permission denied for function bootstrap_overview");

    await expect(call()).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("does not read a signed-in 403 as a sign-out", async () => {
    respondWith(403, "permission denied for function bootstrap_overview");

    await expect(rpc("bootstrap_overview", {}, acceptAnything)).rejects.not.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("reads a request that never reached the server as offline", async () => {
    respondWith(0, "TypeError: Load failed", "");

    await expect(rpc("bootstrap_overview", {}, acceptAnything)).rejects.toMatchObject({
      code: "network",
    });
  });
});
