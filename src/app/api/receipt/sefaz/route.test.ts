import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase server client
const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

// Mock the nfce module
const mockFetchSefazPage = vi.fn();
const mockParseSefazPage = vi.fn();
vi.mock("@/lib/nfce", () => ({
  fetchSefazPage: (...args: unknown[]) => mockFetchSefazPage(...args),
  parseSefazPage: (...args: unknown[]) => mockParseSefazPage(...args),
}));

const { POST } = await import("./route");

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/receipt/sefaz", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/receipt/sefaz", () => {
  const authenticatedUser = {
    data: { user: { id: "user-123" } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(authenticatedUser);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(jsonRequest({ url: "https://nfce.sefaz.sp.gov.br/consulta" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Nao autenticado");
  });

  it("returns 400 when url is missing", async () => {
    const res = await POST(jsonRequest({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Campo 'url' obrigatorio");
  });

  it("returns 400 when url is not a string", async () => {
    const res = await POST(jsonRequest({ url: 123 }));

    expect(res.status).toBe(400);
  });

  it("returns 400 when url is not HTTP(S)", async () => {
    const res = await POST(jsonRequest({ url: "ftp://nfce.sefaz.sp.gov.br" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("URL deve ser HTTP ou HTTPS");
  });

  it("returns 400 for invalid URL", async () => {
    const res = await POST(jsonRequest({ url: "not-a-url" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("URL invalida");
  });

<<<<<<< HEAD
  it("returns 400 for non-SEFAZ domain (SSRF protection)", async () => {
    const res = await POST(jsonRequest({ url: "http://localhost:54321" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("URL deve ser de um portal SEFAZ");
    expect(mockFetchSefazPage).not.toHaveBeenCalled();
  });

  it("returns 400 for cloud metadata endpoint (SSRF protection)", async () => {
    const res = await POST(jsonRequest({ url: "http://169.254.169.254/latest/meta-data/" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("URL deve ser de um portal SEFAZ");
    expect(mockFetchSefazPage).not.toHaveBeenCalled();
  });

  it("returns 400 for arbitrary external domain (SSRF protection)", async () => {
    const res = await POST(jsonRequest({ url: "https://evil.com/steal-data" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("URL deve ser de um portal SEFAZ");
    expect(mockFetchSefazPage).not.toHaveBeenCalled();
  });

  it("accepts sefaz.sp.gov.br domain", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>...</html>" });
    mockParseSefazPage.mockReturnValue({
      merchant: "Loja",
      items: [{ description: "Item", quantity: 1, unitPriceCents: 100, totalCents: 100 }],
      serviceFeePercent: 0,
      totalCents: 100,
    });

    const res = await POST(jsonRequest({ url: "https://nfce.sefaz.sp.gov.br/consulta" }));

    expect(res.status).toBe(200);
    expect(mockFetchSefazPage).toHaveBeenCalled();
  });

  it("accepts fazenda.rs.gov.br domain", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>...</html>" });
    mockParseSefazPage.mockReturnValue({
      merchant: "Loja",
      items: [{ description: "Item", quantity: 1, unitPriceCents: 100, totalCents: 100 }],
      serviceFeePercent: 0,
      totalCents: 100,
    });

    const res = await POST(jsonRequest({ url: "https://nfce.fazenda.rs.gov.br/consulta" }));

    expect(res.status).toBe(200);
    expect(mockFetchSefazPage).toHaveBeenCalled();
  });

  it("returns parsed receipt on success", async () => {
    const ocrResult = {
      merchant: "Padaria Central",
      items: [
        { description: "Pao Frances", quantity: 10, unitPriceCents: 50, totalCents: 500 },
      ],
      serviceFeePercent: 0,
      totalCents: 500,
    };
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>...</html>" });
    mockParseSefazPage.mockReturnValue(ocrResult);

    const res = await POST(jsonRequest({ url: "https://nfce.sefaz.sp.gov.br/consulta?chNFe=1234" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(ocrResult);
    expect(mockFetchSefazPage).toHaveBeenCalledWith("https://nfce.sefaz.sp.gov.br/consulta?chNFe=1234");
    expect(mockParseSefazPage).toHaveBeenCalledWith("<html>...</html>");
  });

  it("returns 502 with fallback when fetch fails", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: false, error: "CAPTCHA detectado" });

    const res = await POST(jsonRequest({ url: "https://nfce.sefaz.sp.gov.br/consulta" }));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("CAPTCHA detectado");
    expect(body.fallback).toBe(true);
  });

  it("returns 502 with fallback when html is missing", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: undefined });

    const res = await POST(jsonRequest({ url: "https://nfce.sefaz.sp.gov.br/consulta" }));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.fallback).toBe(true);
  });

  it("returns 422 with fallback when no items extracted", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>empty</html>" });
    mockParseSefazPage.mockReturnValue({ merchant: null, items: [], serviceFeePercent: 0, totalCents: 0 });

    const res = await POST(jsonRequest({ url: "https://nfce.sefaz.sp.gov.br/consulta" }));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fallback).toBe(true);
    expect(body.error).toBe("Nao foi possivel extrair itens da pagina");
  });

  it("returns 422 with fallback when parser returns null", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>broken</html>" });
    mockParseSefazPage.mockReturnValue(null);

    const res = await POST(jsonRequest({ url: "https://nfce.sefaz.sp.gov.br/consulta" }));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fallback).toBe(true);
  });

  it("returns 400 when body is not JSON", async () => {
    const req = new Request("http://localhost/api/receipt/sefaz", {
      method: "POST",
      body: "not-json",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});
