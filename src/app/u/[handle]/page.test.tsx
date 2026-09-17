import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppError } from "@/lib/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  lookupProfile: vi.fn(),
  getClaims: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/lib/profile-lookup", () => ({ lookupProfile: mocks.lookupProfile }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: mocks.getClaims } }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill, priority, ...rest } = props;
    void fill;
    void priority;
    return <img alt="" {...rest} />;
  },
}));
vi.mock("./profile-actions", () => ({
  SendMessageButton: (props: { targetName: string }) => (
    <button type="button">{`Enviar mensagem para ${props.targetName}`}</button>
  ),
  SplitBillButton: (props: { targetName: string }) => (
    <button type="button">{`Dividir uma conta com ${props.targetName}`}</button>
  ),
}));

import PublicProfilePage from "./page";

const PROFILE = { id: "user-bob", handle: "daniel", name: "Daniel Santos", avatarUrl: null, isBot: false };

function renderPage(handle: string): Promise<string> {
  return Promise.resolve({ handle }).then((params) =>
    PublicProfilePage({ params: Promise.resolve(params) }).then((element) =>
      renderToStaticMarkup(element),
    ),
  );
}

beforeEach(() => {
  mocks.lookupProfile.mockReset();
  mocks.getClaims.mockReset();
  mocks.notFound.mockClear();
});

describe("/u/[handle]", () => {
  it("renders the profile with contact actions for another authenticated viewer", async () => {
    mocks.lookupProfile.mockResolvedValueOnce(PROFILE);
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: { sub: "user-alice" } } });

    const html = await renderPage("Daniel");

    expect(mocks.lookupProfile).toHaveBeenCalledExactlyOnceWith("daniel");
    expect(html).toContain("Daniel Santos");
    expect(html).toContain("@daniel");
    expect(html).toContain("Dividir uma conta com Daniel Santos");
    expect(html).toContain("Enviar mensagem para Daniel Santos");
    expect(html).not.toContain("Criar conta");
    expect(html).not.toContain("Bot verificado");
  });

  it("renders the Bot verificado pill for bot profiles", async () => {
    mocks.lookupProfile.mockResolvedValueOnce({ ...PROFILE, isBot: true });
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: { sub: "user-alice" } } });

    const html = await renderPage("daniel");

    expect(html).toMatch(/>\s*Bot verificado\s*</);
  });

  it("renders the self branch for the profile owner", async () => {
    mocks.lookupProfile.mockResolvedValueOnce(PROFILE);
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: { sub: "user-bob" } } });

    const html = await renderPage("daniel");

    expect(html).toContain("Ir para meu perfil");
    expect(html).not.toContain("Dividir uma conta com");
    expect(html).not.toContain("Enviar mensagem para");
  });

  it("calls notFound when no onboarded profile owns the handle", async () => {
    mocks.lookupProfile.mockResolvedValueOnce(null);

    await expect(renderPage("ghost")).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("calls notFound for a handle that is empty after normalization", async () => {
    mocks.lookupProfile.mockRejectedValueOnce(
      new AppError("USER_INVALID_HANDLE", "Handle obrigatorio"),
    );

    await expect(renderPage("%20")).rejects.toThrow("NOT_FOUND");
  });

  it("renders the unavailable fallback when the boundary fails closed", async () => {
    mocks.lookupProfile.mockRejectedValueOnce(
      new AppError("RATE_LIMIT_UNAVAILABLE", "Serviço temporariamente indisponível"),
    );

    const html = await renderPage("daniel");

    expect(html).toContain("indisponível");
    expect(html).not.toContain("Dividir uma conta com");
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it("keeps the anonymous CTA branch when the boundary rejects with 401", async () => {
    mocks.lookupProfile.mockRejectedValueOnce(new AppError("AUTH_UNAUTHORIZED", "Não autenticado"));

    const html = await renderPage("Daniel");

    expect(html).toContain("Criar conta");
    expect(html).toContain("@daniel");
    expect(html).toContain("Perfil no Dividimos");
    expect(html).not.toContain("Dividir uma conta com");
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });
});
