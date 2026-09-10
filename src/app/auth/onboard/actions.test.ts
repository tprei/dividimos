import { AuthSessionMissingError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/types/ledger";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  createClient: vi.fn(),
  resolveAuthProfile: vi.fn(),
  encryptPixKey: vi.fn().mockReturnValue("encrypted"),
  maskPixKey: vi.fn().mockReturnValue("hint"),
  validatePixKey: vi.fn().mockReturnValue(true),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/auth", () => ({ resolveAuthProfile: mocks.resolveAuthProfile }));
vi.mock("@/lib/crypto", () => ({ encryptPixKey: mocks.encryptPixKey }));
vi.mock("@/lib/pix", () => ({
  maskPixKey: mocks.maskPixKey,
  validatePixKey: mocks.validatePixKey,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { completeOnboarding } from "./actions";

const profile = (overrides: Partial<Me> = {}): Me => ({
  id: "user-a",
  handle: "ana_costa",
  name: "Ana Costa",
  avatarUrl: null,
  email: "ana@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: false,
  notificationPreferences: {},
  ...overrides,
});

function form(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set("handle", overrides.handle ?? "ana_costa");
  formData.set("name", overrides.name ?? "Ana Costa");
  formData.set("pixKey", overrides.pixKey ?? "ana@example.com");
  formData.set("pixKeyType", overrides.pixKeyType ?? "email");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
  mocks.resolveAuthProfile.mockResolvedValue({ kind: "ok", me: profile() });
  mocks.rpc.mockResolvedValue({ data: { kind: "completed" }, error: null });
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
});

describe("completeOnboarding", () => {
  it("authorizes before reading FormData when the rendered action is invoked under another user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-b" } }, error: null });
    const formData = form();
    const get = vi.spyOn(formData, "get");

    await expect(completeOnboarding("user-a", "/app", formData)).resolves.toEqual({
      error: "Sessão expirada",
    });

    expect(get).not.toHaveBeenCalled();
    expect(mocks.encryptPixKey).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a profile identity mismatch before reading FormData", async () => {
    mocks.resolveAuthProfile.mockResolvedValue({ kind: "ok", me: profile({ id: "user-b" }) });
    const formData = form();
    const get = vi.spyOn(formData, "get");

    await expect(completeOnboarding("user-a", "/app", formData)).resolves.toEqual({
      error: "Sessão expirada",
    });

    expect(get).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a typed missing session error before reading FormData", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    const formData = form();
    const get = vi.spyOn(formData, "get");

    await expect(completeOnboarding("user-a", "/app", formData)).resolves.toEqual({
      error: "Sessão expirada",
    });

    expect(get).not.toHaveBeenCalled();
    expect(mocks.resolveAuthProfile).not.toHaveBeenCalled();
  });


  it("redirects an already completed profile without reading stale form values", async () => {
    mocks.resolveAuthProfile.mockResolvedValue({ kind: "ok", me: profile({ onboarded: true }) });
    const formData = form();
    const get = vi.spyOn(formData, "get");

    await expect(completeOnboarding("user-a", "/app/groups", formData)).rejects.toThrow(
      "REDIRECT:/app/groups",
    );

    expect(get).not.toHaveBeenCalled();
    expect(mocks.encryptPixKey).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("validates the Pix enum before encrypting or calling the RPC", async () => {
    const formData = form({ pixKeyType: "unsupported" });

    await expect(completeOnboarding("user-a", "/app", formData)).resolves.toEqual({
      error: "Tipo de chave Pix inválido.",
    });

    expect(mocks.validatePixKey).not.toHaveBeenCalled();
    expect(mocks.encryptPixKey).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a handle conflict without changing the retryable form flow", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "handle_taken" } });

    await expect(completeOnboarding("user-a", "/app", form())).resolves.toEqual({
      error: "Handle já em uso. Escolha outro.",
    });

    expect(mocks.encryptPixKey).toHaveBeenCalledWith("ana@example.com");
    expect(mocks.maskPixKey).toHaveBeenCalledWith("ana@example.com");
  });
  it("encrypts the validated key and redirects after a successful RPC", async () => {
    await expect(completeOnboarding("user-a", "/app/groups", form())).rejects.toThrow(
      "REDIRECT:/app/groups",
    );

    expect(mocks.validatePixKey).toHaveBeenCalledWith("ana@example.com", "email");
    expect(mocks.rpc).toHaveBeenCalledWith("complete_onboarding", {
      p_handle: "ana_costa",
      p_name: "Ana Costa",
      p_pix_key_encrypted: "encrypted",
      p_pix_key_hint: "hint",
      p_pix_key_type: "email",
    });
  });
});
