import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

vi.mock("@/lib/crypto", () => ({
  encryptPixKey: vi.fn((v: string) => `enc:${v}`),
}));

vi.mock("@/lib/pix", () => ({
  validatePixKey: vi.fn(),
  maskPixKey: vi.fn((v: string) => `hint:${v}`),
}));

import { createClient } from "@/lib/supabase/server";
import { encryptPixKey } from "@/lib/crypto";
import { validatePixKey, maskPixKey } from "@/lib/pix";
import { completeOnboarding, type CompleteOnboardingResult } from "./actions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type UpdateOutcome = { data: unknown; error: { code?: string; message?: string } | null };
type ReadOutcome = { data: { onboarded: boolean } | null; error: unknown };

type ClientHandle = {
  eqCalls: Array<{ column: string; value: unknown }>;
  getPayload: () => unknown;
};

function mockClient(
  userId: string | null,
  updateOutcome: UpdateOutcome,
  readOutcome?: ReadOutcome,
): ClientHandle {
  const eqCalls: Array<{ column: string; value: unknown }> = [];
  let updatePayload: unknown = null;

  const updateChain = {
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push({ column, value });
      return updateChain;
    }),
    select: vi.fn(() => Promise.resolve(updateOutcome)),
  };

  const readChain = {
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push({ column, value });
      return readChain;
    }),
    maybeSingle: vi.fn(() =>
      Promise.resolve(readOutcome ?? { data: null, error: null }),
    ),
  };

  const builder = {
    update: vi.fn((payload: unknown) => {
      updatePayload = payload;
      return updateChain;
    }),
    select: vi.fn(() => readChain),
  };

  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: vi.fn(() => builder),
  } as unknown as SupabaseClient<Database>);

  return { eqCalls, getPayload: () => updatePayload };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class ThrowingFormData extends FormData {
  readonly reads: string[] = [];
  get(name: string): FormDataEntryValue | null {
    this.reads.push(name);
    throw new Error(`unexpected FormData.get(${name})`);
  }
}

function validFormData() {
  const fd = new FormData();
  fd.set("name", "  Ana Costa  ");
  fd.set("handle", "Ana.C");
  fd.set("pixKeyType", "email");
  fd.set("pixKey", "ana@test.com");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(validatePixKey).mockReturnValue(true);
});

describe("completeOnboarding", () => {
  describe("auth gating runs before any FormData read", () => {
    it("returns identity_changed with zero reads, validation, encryption, or writes when the session differs", async () => {
      const handle = mockClient("user-b", { data: [{ id: "user-b" }], error: null });

      const fd = new ThrowingFormData();
      fd.set("name", "x");
      const result = await completeOnboarding("user-a", "/app", fd);

      expect(result).toEqual<CompleteOnboardingResult>({
        kind: "rejected",
        reason: "identity_changed",
      });
      expect(fd.reads).toHaveLength(0);
      expect(encryptPixKey).not.toHaveBeenCalled();
      expect(handle.eqCalls).toHaveLength(0);
    });

    it("returns unauthenticated with zero reads when there is no session", async () => {
      const handle = mockClient(null, { data: [], error: null });

      const fd = new ThrowingFormData();
      fd.set("name", "x");
      const result = await completeOnboarding("user-a", "/app", fd);

      expect(result).toEqual<CompleteOnboardingResult>({
        kind: "rejected",
        reason: "unauthenticated",
      });
      expect(fd.reads).toHaveLength(0);
      expect(encryptPixKey).not.toHaveBeenCalled();
      expect(handle.eqCalls).toHaveLength(0);
    });
  });

  describe("field validation under matching auth", () => {
    it.each([
      {
        label: "missing name",
        mutate: (fd: FormData) => fd.delete("name"),
        reason: "invalid_name" as const,
      },
      {
        label: "blank name",
        mutate: (fd: FormData) => fd.set("name", "   "),
        reason: "invalid_name" as const,
      },
      {
        label: "non-string name (File)",
        mutate: (fd: FormData) =>
          fd.set("name", new File([""], "n", { type: "text/plain" })),
        reason: "invalid_name" as const,
      },
      {
        label: "missing handle",
        mutate: (fd: FormData) => fd.delete("handle"),
        reason: "invalid_handle" as const,
      },
      {
        label: "too-short handle",
        mutate: (fd: FormData) => fd.set("handle", "ab"),
        reason: "invalid_handle" as const,
      },
      {
        label: "non-string handle (File)",
        mutate: (fd: FormData) =>
          fd.set("handle", new File([""], "h", { type: "text/plain" })),
        reason: "invalid_handle" as const,
      },
      {
        label: "unknown pixKeyType",
        mutate: (fd: FormData) => fd.set("pixKeyType", "bitcoin"),
        reason: "invalid_pix_type" as const,
      },
      {
        label: "missing pixKeyType",
        mutate: (fd: FormData) => fd.delete("pixKeyType"),
        reason: "invalid_pix_type" as const,
      },
      {
        label: "invalid pixKey",
        mutate: (fd: FormData) => fd.set("pixKey", "nope"),
        reason: "invalid_pix_key" as const,
        pixInvalid: true,
      },
      {
        label: "non-string pixKey (File)",
        mutate: (fd: FormData) =>
          fd.set("pixKey", new File([""], "p", { type: "text/plain" })),
        reason: "invalid_pix_key" as const,
      },
    ])(
      "rejects with $reason for $label without encrypting or persisting",
      async ({ mutate, reason, pixInvalid }) => {
        mockClient("user-a", { data: [{ id: "user-a" }], error: null });
        if (pixInvalid) vi.mocked(validatePixKey).mockReturnValue(false);

        const fd = validFormData();
        mutate(fd);
        const result = await completeOnboarding("user-a", "/app", fd);

        expect(result).toEqual<CompleteOnboardingResult>({
          kind: "rejected",
          reason,
        });
        expect(encryptPixKey).not.toHaveBeenCalled();
        expect(maskPixKey).not.toHaveBeenCalled();
      },
    );
  });

  it("writes the trimmed, canonical, encrypted tuple under both filters on a valid draft", async () => {
    const handle = mockClient("user-a", { data: [{ id: "user-a" }], error: null });

    const result = await completeOnboarding("user-a", "/dashboard", validFormData());

    expect(result).toEqual<CompleteOnboardingResult>({
      kind: "completed",
      redirectTo: "/dashboard",
    });
    expect(encryptPixKey).toHaveBeenCalledWith("ana@test.com");
    expect(maskPixKey).toHaveBeenCalledWith("ana@test.com");
    expect(handle.getPayload()).toEqual({
      name: "Ana Costa",
      handle: "ana.c",
      pix_key_encrypted: "enc:ana@test.com",
      pix_key_hint: "hint:ana@test.com",
      pix_key_type: "email",
      onboarded: true,
    });
    expect(handle.eqCalls).toEqual([
      { column: "id", value: "user-a" },
      { column: "onboarded", value: false },
    ]);
  });

  it("maps a 23505 unique violation to handle_taken without touching the prior row", async () => {
    const handle = mockClient("user-a", {
      data: null,
      error: { code: "23505", message: "dup" },
    });

    const result = await completeOnboarding("user-a", "/app", validFormData());

    expect(result).toEqual<CompleteOnboardingResult>({
      kind: "rejected",
      reason: "handle_taken",
    });
    expect(handle.eqCalls).toEqual([
      { column: "id", value: "user-a" },
      { column: "onboarded", value: false },
    ]);
  });

  it("treats a replay after onboarding as completed with the first tuple left intact", async () => {
    // First draft lands (1 row).
    mockClient("user-a", { data: [{ id: "user-a" }], error: null });
    const first = await completeOnboarding("user-a", "/app", validFormData());
    expect(first).toEqual<CompleteOnboardingResult>({
      kind: "completed",
      redirectTo: "/app",
    });
    const firstCiphertext = vi.mocked(encryptPixKey).mock.results[0].value;

    // Replay: update matches zero rows, read reports onboarded=true.
    mockClient("user-a", { data: [], error: null }, {
      data: { onboarded: true },
      error: null,
    });
    const secondFd = validFormData();
    secondFd.set("handle", "other.handle");
    const second = await completeOnboarding("user-a", "/app", secondFd);

    expect(second).toEqual<CompleteOnboardingResult>({
      kind: "completed",
      redirectTo: "/app",
    });
    // The first ciphertext is unchanged by the no-op replay.
    expect(vi.mocked(encryptPixKey).mock.results[0].value).toBe(firstCiphertext);
  });

  it("two concurrent drafts honouring both filters store exactly one tuple (predicate is load-bearing)", async () => {
    let onboarded = false;
    const stored: unknown[] = [];
    const pending: Array<{
      payload: unknown;
      eqs: Array<{ column: string; value: unknown }>;
      resolve: (r: UpdateOutcome) => void;
    }> = [];

    const buildReadChain = () => {
      const self = {
        eq: vi.fn(() => self),
        maybeSingle: vi.fn(() =>
          Promise.resolve({ data: { onboarded }, error: null }),
        ),
      };
      return self;
    };

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-a" } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        update: vi.fn((payload: unknown) => {
          const d = deferred<UpdateOutcome>();
          const eqs: Array<{ column: string; value: unknown }> = [];
          pending.push({ payload, eqs, resolve: d.resolve });
          const self = {
            eq: vi.fn((column: string, value: unknown) => {
              eqs.push({ column, value });
              return self;
            }),
            select: vi.fn(() => d.promise),
          };
          return self;
        }),
        select: vi.fn(() => buildReadChain()),
      })),
    } as unknown as SupabaseClient<Database>);

    const releaseUpdate = (index: number) => {
      const entry = pending[index];
      const hasOnboardedPredicate = entry.eqs.some(
        (e) => e.column === "onboarded" && e.value === false,
      );
      if (hasOnboardedPredicate && onboarded) {
        entry.resolve({ data: [], error: null });
      } else {
        onboarded = true;
        stored.push(entry.payload);
        entry.resolve({ data: [{ id: "user-a" }], error: null });
      }
    };

    const fd1 = validFormData();
    const fd2 = validFormData();
    fd2.set("handle", "second.handle");

    const p1 = completeOnboarding("user-a", "/app", fd1);
    const p2 = completeOnboarding("user-a", "/app", fd2);

    // Let both calls drain their auth awaits and reach the deferred update.
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(pending).toHaveLength(2);

    releaseUpdate(0);
    const r1 = await p1;
    expect(r1).toEqual<CompleteOnboardingResult>({
      kind: "completed",
      redirectTo: "/app",
    });

    releaseUpdate(1);
    const r2 = await p2;
    expect(r2).toEqual<CompleteOnboardingResult>({
      kind: "completed",
      redirectTo: "/app",
    });

    expect(stored).toHaveLength(1);
  });

  describe("zero-row and error classification", () => {
    it("zero-row update with a missing profile reads back null → profile_unavailable", async () => {
      mockClient("user-a", { data: [], error: null }, {
        data: null,
        error: null,
      });
      const result = await completeOnboarding("user-a", "/app", validFormData());
      expect(result).toEqual<CompleteOnboardingResult>({
        kind: "rejected",
        reason: "profile_unavailable",
      });
    });

    it("zero-row update with onboarded=false → save_failed", async () => {
      mockClient("user-a", { data: [], error: null }, {
        data: { onboarded: false },
        error: null,
      });
      const result = await completeOnboarding("user-a", "/app", validFormData());
      expect(result).toEqual<CompleteOnboardingResult>({
        kind: "rejected",
        reason: "save_failed",
      });
    });

    it("an update error surfaces save_failed with no raw error text", async () => {
      mockClient("user-a", {
        data: null,
        error: { code: "XX000", message: "secret-stack-trace" },
      });
      const result = await completeOnboarding("user-a", "/app", validFormData());
      expect(result).toEqual<CompleteOnboardingResult>({
        kind: "rejected",
        reason: "save_failed",
      });
      expect(JSON.stringify(result)).not.toContain("secret");
    });

    it("a replay-read error surfaces save_failed with no raw error text", async () => {
      mockClient("user-a", { data: [], error: null }, {
        data: null,
        error: { message: "secret-read-failure" },
      });
      const result = await completeOnboarding("user-a", "/app", validFormData());
      expect(result).toEqual<CompleteOnboardingResult>({
        kind: "rejected",
        reason: "save_failed",
      });
      expect(JSON.stringify(result)).not.toContain("secret");
    });
  });
});
