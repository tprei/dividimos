import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase server client
const mockGetUser = vi.fn();
const mockGetClaims = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
      getClaims: () => mockGetClaims(),
    },
  }),
}));

// Mock the nfce module
const mockFetchSefazPage = vi.fn();
const mockParseSefazPage = vi.fn();
const mockExtractSefazAccessKeys = vi.fn();
vi.mock("@/lib/nfce", () => ({
  fetchSefazPage: (...args: unknown[]) => mockFetchSefazPage(...args),
  parseSefazPage: (...args: unknown[]) => mockParseSefazPage(...args),
  extractSefazAccessKeys: (...args: unknown[]) => mockExtractSefazAccessKeys(...args),
  SEFAZ_DOMAIN_PATTERN: /\.(fazenda|sefaz|sef|svrs)\.[a-z]{2}\.gov\.br$/i,
}));

const { POST, runtime, maxDuration } = await import("./route");

const RECEIPT_ACCESS_KEY = "35240199999999999999550010000001231234567890";
const OTHER_ACCESS_KEY = "91234567890123456789012345678901234567890123";
const SEFAZ_URL = "https://nfce.sefaz.sp.gov.br/consulta";

const parsedResult = {
  merchant: "Padaria Central",
  items: [
    { description: "Pao Frances", quantity: 10, unitPriceCents: 50, totalCents: 500 },
  ],
  serviceFeeBasisPoints: 0,
  fixedFeesCents: 0,
  totalCents: 500,
};

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/receipt/sefaz", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function keyedRequest(overrides: Record<string, unknown> = {}) {
  return jsonRequest({ url: SEFAZ_URL, receiptAccessKey: RECEIPT_ACCESS_KEY, ...overrides });
}

describe("POST /api/receipt/sefaz", () => {
  const authenticatedUser = {
    data: { user: { id: "user-123" } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "user-123" } }, error: null });
    mockExtractSefazAccessKeys.mockReturnValue([RECEIPT_ACCESS_KEY]);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockGetClaims.mockResolvedValue({ data: null, error: null });

    const res = await POST(keyedRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Não autenticado");
  });

  it("returns 400 when url is missing", async () => {
    const res = await POST(jsonRequest({ receiptAccessKey: RECEIPT_ACCESS_KEY }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Campo 'url' obrigatorio");
  });

  it("returns 400 when url is not a string", async () => {
    const res = await POST(jsonRequest({ url: 123, receiptAccessKey: RECEIPT_ACCESS_KEY }));

    expect(res.status).toBe(400);
  });

  it("returns 400 when receiptAccessKey is missing", async () => {
    const res = await POST(jsonRequest({ url: SEFAZ_URL }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Campo 'receiptAccessKey' deve conter 44 digitos");
    expect(mockFetchSefazPage).not.toHaveBeenCalled();
  });

  it("returns 400 when receiptAccessKey is not a string", async () => {
    const res = await POST(jsonRequest({ url: SEFAZ_URL, receiptAccessKey: 123456 }));

    expect(res.status).toBe(400);
    expect(mockFetchSefazPage).not.toHaveBeenCalled();
  });

  it("returns 400 when receiptAccessKey is not 44 digits", async () => {
    for (const bad of ["123", "abc".padEnd(44, "1"), "1".repeat(43), "1".repeat(45), `${"1".repeat(43)}x`]) {
      const res = await POST(jsonRequest({ url: SEFAZ_URL, receiptAccessKey: bad }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Campo 'receiptAccessKey' deve conter 44 digitos");
    }
    expect(mockFetchSefazPage).not.toHaveBeenCalled();
  });

  it("validates the expected key before any SEFAZ fetch", async () => {
    // Even a perfectly valid URL must not be fetched when the key is invalid.
    const res = await POST(jsonRequest({ url: SEFAZ_URL, receiptAccessKey: "short" }));

    expect(res.status).toBe(400);
    expect(mockFetchSefazPage).not.toHaveBeenCalled();
  });

  it("returns 400 when url is not HTTP(S)", async () => {
    const res = await POST(keyedRequest({ url: "ftp://nfce.sefaz.sp.gov.br" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("URL deve ser HTTP ou HTTPS");
  });

  it("returns 400 for invalid URL", async () => {
    const res = await POST(keyedRequest({ url: "not-a-url" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("URL invalida");
  });

  it("returns 400 for non-SEFAZ domain (SSRF protection)", async () => {
    const res = await POST(keyedRequest({ url: "http://localhost:54321" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("URL deve ser de um portal SEFAZ");
    expect(mockFetchSefazPage).not.toHaveBeenCalled();
  });

  it("returns 400 for cloud metadata endpoint (SSRF protection)", async () => {
    const res = await POST(keyedRequest({ url: "http://169.254.169.254/latest/meta-data/" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("URL deve ser de um portal SEFAZ");
    expect(mockFetchSefazPage).not.toHaveBeenCalled();
  });

  it("returns 400 for arbitrary external domain (SSRF protection)", async () => {
    const res = await POST(keyedRequest({ url: "https://evil.com/steal-data" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("URL deve ser de um portal SEFAZ");
    expect(mockFetchSefazPage).not.toHaveBeenCalled();
  });

  it("accepts sefaz.sp.gov.br domain", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>...</html>" });
    mockParseSefazPage.mockReturnValue(parsedResult);

    const res = await POST(keyedRequest());

    expect(res.status).toBe(200);
    expect(mockFetchSefazPage).toHaveBeenCalled();
  });

  it("accepts fazenda.rs.gov.br domain", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>...</html>" });
    mockParseSefazPage.mockReturnValue(parsedResult);

    const res = await POST(keyedRequest({ url: "https://nfce.fazenda.rs.gov.br/consulta" }));

    expect(res.status).toBe(200);
    expect(mockFetchSefazPage).toHaveBeenCalled();
  });

  it("accepts SVRS (Sefaz Virtual RS) domain used by ~10 states", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>...</html>" });
    mockParseSefazPage.mockReturnValue(parsedResult);

    const res = await POST(keyedRequest({ url: "https://nfe.svrs.rs.gov.br/NFCE/consulta" }));

    expect(res.status).toBe(200);
    expect(mockFetchSefazPage).toHaveBeenCalled();
  });

  it("returns parsed receipt on success", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>...</html>" });
    mockParseSefazPage.mockReturnValue(parsedResult);

    const url = "https://nfce.sefaz.sp.gov.br/consulta?chNFe=1234";
    const res = await POST(jsonRequest({ url, receiptAccessKey: RECEIPT_ACCESS_KEY }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(parsedResult);
    expect(mockFetchSefazPage).toHaveBeenCalledWith(url);
    expect(mockExtractSefazAccessKeys).toHaveBeenCalledWith("<html>...</html>");
    expect(mockParseSefazPage).toHaveBeenCalledWith(
      "<html>...</html>",
      RECEIPT_ACCESS_KEY,
    );
  });

  it("returns 502 with fallback when fetch fails", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: false, error: "CAPTCHA detectado" });

    const res = await POST(keyedRequest());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("CAPTCHA detectado");
    expect(body.fallback).toBe(true);
  });

  it("returns 502 with fallback when html is missing", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: undefined });

    const res = await POST(keyedRequest());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.fallback).toBe(true);
  });
  it("returns 422 with fallback when fetch succeeds with an empty document", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "" });
    mockExtractSefazAccessKeys.mockReturnValue([]);
    mockParseSefazPage.mockReturnValue(parsedResult);

    const res = await POST(keyedRequest());

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fallback).toBe(true);
    expect(body.error).toBe("Não foi possível validar a identidade da nota fiscal");
    expect(mockParseSefazPage).not.toHaveBeenCalled();
  });

  it("returns 422 with fallback when the page declares no dedicated access key", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>sem chave</html>" });
    mockExtractSefazAccessKeys.mockReturnValue([]);
    mockParseSefazPage.mockReturnValue(parsedResult);

    const res = await POST(keyedRequest());

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fallback).toBe(true);
    expect(body.error).toBe("Não foi possível validar a identidade da nota fiscal");
    // Item parsing must not run — or be trusted — when identity did not bind.
    expect(mockParseSefazPage).not.toHaveBeenCalled();
  });

  it("returns 422 with fallback when the page exposes an ambiguous identity", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>duas chaves</html>" });
    mockExtractSefazAccessKeys.mockReturnValue([RECEIPT_ACCESS_KEY, OTHER_ACCESS_KEY]);
    mockParseSefazPage.mockReturnValue(parsedResult);

    const res = await POST(keyedRequest());

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fallback).toBe(true);
    expect(body.error).toBe("Não foi possível validar a identidade da nota fiscal");
    expect(mockParseSefazPage).not.toHaveBeenCalled();
  });

  it("returns 422 with fallback when the page identity mismatches the expected key", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>outra chave</html>" });
    mockExtractSefazAccessKeys.mockReturnValue([OTHER_ACCESS_KEY]);
    mockParseSefazPage.mockReturnValue(parsedResult);

    const res = await POST(keyedRequest());

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fallback).toBe(true);
    expect(body.error).toBe("Não foi possível validar a identidade da nota fiscal");
    expect(mockParseSefazPage).not.toHaveBeenCalled();
  });

  it("returns 422 with fallback when no items extracted", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>empty</html>" });
    mockParseSefazPage.mockReturnValue({
      merchant: null,
      items: [],
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 0,
      totalCents: 0,
    });

    const res = await POST(keyedRequest());

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fallback).toBe(true);
    expect(body.error).toBe("Não foi possível extrair itens da página");
  });

  it("returns 422 with fallback when parser returns null", async () => {
    mockFetchSefazPage.mockResolvedValue({ ok: true, html: "<html>broken</html>" });
    mockParseSefazPage.mockReturnValue(null);

    const res = await POST(keyedRequest());

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

describe("route segment config", () => {
  it("exports nodejs runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("exports maxDuration of 15 seconds", () => {
    expect(maxDuration).toBe(15);
  });
});
