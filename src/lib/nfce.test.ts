import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseSefazPage,
  parseBrlToCents,
  isAllowedSefazUrl,
  fetchSefazPage,
} from "./nfce";

describe("parseBrlToCents", () => {
  it("parses Brazilian format with comma decimal", () => {
    expect(parseBrlToCents("12,50")).toBe(1250);
  });

  it("parses with thousands separator", () => {
    expect(parseBrlToCents("1.234,56")).toBe(123456);
  });

  it("parses with R$ prefix", () => {
    expect(parseBrlToCents("R$ 12,50")).toBe(1250);
  });

  it("parses dot-decimal format", () => {
    expect(parseBrlToCents("12.50")).toBe(1250);
  });

  it("parses integer value", () => {
    expect(parseBrlToCents("100")).toBe(10000);
  });

  it("returns 0 for empty string", () => {
    expect(parseBrlToCents("")).toBe(0);
  });

  it("returns 0 for non-numeric", () => {
    expect(parseBrlToCents("abc")).toBe(0);
  });

  it("handles thousands-only dot (1.234 = 1234 reais)", () => {
    expect(parseBrlToCents("1.234")).toBe(123400);
  });

  it("parses small values", () => {
    expect(parseBrlToCents("0,99")).toBe(99);
  });

  it("parses large values", () => {
    expect(parseBrlToCents("10.543,21")).toBe(1054321);
  });
});

describe("parseSefazPage", () => {
  it("returns null for empty HTML", () => {
    expect(parseSefazPage("")).toBeNull();
  });

  it("returns null for HTML with no items", () => {
    const html = "<html><body><h1>Nota Fiscal</h1></body></html>";
    expect(parseSefazPage(html)).toBeNull();
  });

  it("extracts items from SP-style table layout", () => {
    const html = `
      <html><body>
        <div class="txtTopo">RESTAURANTE TESTE LTDA</div>
        <table class="toggable">
          <tr>
            <td>Descrição</td><td>Qtde</td><td>Vl. Unit</td><td>Vl. Total</td>
          </tr>
          <tr>
            <td>Cerveja Brahma 600ml</td>
            <td>2,000</td>
            <td>12,90</td>
            <td>25,80</td>
          </tr>
          <tr>
            <td>Picanha 400g</td>
            <td>1,000</td>
            <td>89,90</td>
            <td>89,90</td>
          </tr>
        </table>
        <div id="linhaTotal"><span class="txtMax">115,70</span></div>
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.merchant).toBe("RESTAURANTE TESTE LTDA");
    expect(result!.items).toHaveLength(2);
    expect(result!.items[0]).toEqual({
      description: "Cerveja Brahma 600ml",
      quantity: 2,
      unitPriceCents: 1290,
      totalCents: 2580,
    });
    expect(result!.items[1]).toEqual({
      description: "Picanha 400g",
      quantity: 1,
      unitPriceCents: 8990,
      totalCents: 8990,
    });
    expect(result!.totalCents).toBe(11570);
    expect(result!.serviceFeeBasisPoints).toBe(0);
  });

  it("extracts items from div-based layout", () => {
    const html = `
      <html><body>
        <div class="txtTopo">BAR DO ZE</div>
        <div id="myTable">
          <div class="det">
            <span class="txtTit">Refrigerante Cola 350ml</span>
            <span>Qtde.: 3,000 UN</span>
            <span>Vl. Unit.: 5,50</span>
            <span>Vl. Total: 16,50</span>
          </div>
          <div class="det">
            <span class="txtTit">Pastel de Carne</span>
            <span>Qtde.: 2,000 UN</span>
            <span>Vl. Unit.: 8,00</span>
            <span>Vl. Total: 16,00</span>
          </div>
        </div>
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.merchant).toBe("BAR DO ZE");
    expect(result!.items).toHaveLength(2);
    expect(result!.items[0].description).toBe("Refrigerante Cola 350ml");
    expect(result!.items[0].quantity).toBe(3);
    expect(result!.items[0].unitPriceCents).toBe(550);
    expect(result!.items[0].totalCents).toBe(1650);
    expect(result!.items[1].description).toBe("Pastel de Carne");
    expect(result!.items[1].totalCents).toBe(1600);
  });

  it("extracts items from text-based pattern", () => {
    const html = `
      <html><body>
        <b>MERCADO BOM PRECO</b>
        <div>
          1 Arroz Tio Joao 5kg 2,000 KG 22,90 45,80
          2 Feijao Preto 1kg 3,000 UN 8,50 25,50
        </div>
        <div>VALOR TOTAL R$ 71,30</div>
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(2);
    expect(result!.items[0].description).toBe("Arroz Tio Joao 5kg");
    expect(result!.items[0].quantity).toBe(2);
    expect(result!.items[0].unitPriceCents).toBe(2290);
    expect(result!.items[0].totalCents).toBe(4580);
    expect(result!.totalCents).toBe(7130);
  });

  it("returns null when the page total is missing (never defaults to the item sum, issue #477)", () => {
    const html = `
      <html><body>
        <table class="toggable">
          <tr>
            <td>Agua Mineral 500ml</td>
            <td>1,000</td>
            <td>3,50</td>
            <td>3,50</td>
          </tr>
          <tr>
            <td>Suco Laranja</td>
            <td>1,000</td>
            <td>9,00</td>
            <td>9,00</td>
          </tr>
        </table>
      </body></html>
    `;

    expect(parseSefazPage(html)).toBeNull();
  });

  it("handles Razão Social merchant extraction", () => {
    const html = `
      <html><body>
        <div>Razão Social: PADARIA SANTA CLARA EIRELI</div>
        <table class="toggable">
          <tr>
            <td>Pao Frances</td>
            <td>10,000</td>
            <td>0,80</td>
            <td>8,00</td>
          </tr>
        </table>
        <div>VALOR TOTAL R$ 8,00</div>
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.merchant).toBe("PADARIA SANTA CLARA EIRELI");
  });

  it("cleans up item descriptions", () => {
    const html = `
      <html><body>
        <table class="toggable">
          <tr>
            <td>001 - Coca Cola 2L   7891234567890</td>
            <td>1,000</td>
            <td>10,99</td>
            <td>10,99</td>
          </tr>
        </table>
        <div>VALOR TOTAL R$ 10,99</div>
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.items[0].description).toBe("Coca Cola 2L");
  });

  it("serviceFeeBasisPoints is 0 when no service fee present", () => {
    const html = `
      <html><body>
        <table class="toggable">
          <tr>
            <td>Item Teste</td>
            <td>1,000</td>
            <td>10,00</td>
            <td>10,00</td>
          </tr>
        </table>
        <div>VALOR TOTAL R$ 10,00</div>
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.serviceFeeBasisPoints).toBe(0);
  });

  it("extracts service fee basis points from an explicit percentage", () => {
    const html = `
      <html><body>
        <table class="toggable">
          <tr>
            <td>Cerveja Brahma 600ml</td>
            <td>2,000</td>
            <td>12,90</td>
            <td>25,80</td>
          </tr>
        </table>
        <div>Taxa de Serviço (10%): R$ 2,58</div>
        <div>VALOR TOTAL R$ 28,38</div>
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.serviceFeeBasisPoints).toBe(1000);
  });

  it("extracts service fee basis points from lowercase text", () => {
    const html = `
      <html><body>
        <table class="toggable">
          <tr>
            <td>Picanha</td>
            <td>1,000</td>
            <td>89,90</td>
            <td>89,90</td>
          </tr>
        </table>
        <div>taxa de servico: 12%</div>
        <div>VALOR TOTAL R$ 89,90</div>
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.serviceFeeBasisPoints).toBe(1200);
  });

  it("never derives a service fee percentage from a monetary value divided by subtotal (issue #477)", () => {
    const html = `
      <html><body>
        <table class="toggable">
          <tr>
            <td>Cerveja</td>
            <td>2,000</td>
            <td>15,00</td>
            <td>30,00</td>
          </tr>
          <tr>
            <td>Porção Batata</td>
            <td>1,000</td>
            <td>20,00</td>
            <td>20,00</td>
          </tr>
        </table>
        <div>Subtotal: R$ 50,00</div>
        <div>Taxa de Serviço: R$ 5,00</div>
        <div>VALOR TOTAL R$ 55,00</div>
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    // No explicit "10%" text on the page - only a monetary fee value and a
    // subtotal. The old code derived 5,00/50,00 = 10%; that ratio is never
    // printed as ground truth, so the fix must not fabricate it.
    expect(result!.serviceFeeBasisPoints).toBe(0);
  });
});

describe("isAllowedSefazUrl", () => {
  it("accepts standard state SEFAZ portals", () => {
    expect(
      isAllowedSefazUrl("https://www.nfce.fazenda.sp.gov.br/consulta?p=x"),
    ).toBe(true);
    expect(isAllowedSefazUrl("https://nfce.sefaz.go.gov.br/consulta")).toBe(
      true,
    );
    expect(isAllowedSefazUrl("https://sat.sef.sc.gov.br/consulta")).toBe(true);
  });

  it("accepts SVRS (Sefaz Virtual RS) hosts used by ~10 states", () => {
    expect(isAllowedSefazUrl("https://nfe.svrs.rs.gov.br/consulta?p=x")).toBe(
      true,
    );
    expect(isAllowedSefazUrl("https://www.svrs.rs.gov.br/")).toBe(true);
  });

  it("rejects cloud metadata and private addresses", () => {
    expect(isAllowedSefazUrl("http://169.254.169.254/latest/meta-data")).toBe(
      false,
    );
    expect(isAllowedSefazUrl("http://127.0.0.1/")).toBe(false);
    expect(isAllowedSefazUrl("http://10.0.0.5/")).toBe(false);
  });

  it("rejects look-alike and suffix-attack domains", () => {
    expect(isAllowedSefazUrl("https://evil.com")).toBe(false);
    expect(isAllowedSefazUrl("https://nfe.svrs.rs.gov.br.evil.com/")).toBe(
      false,
    );
    expect(isAllowedSefazUrl("https://sefaz.sp.gov.br.attacker.io/")).toBe(
      false,
    );
  });

  it("rejects non-http(s) schemes and unparseable URLs", () => {
    expect(isAllowedSefazUrl("ftp://nfe.svrs.rs.gov.br/x")).toBe(false);
    expect(isAllowedSefazUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedSefazUrl("not a url")).toBe(false);
  });
});

describe("fetchSefazPage SSRF guards", () => {
  function htmlResponse(html: string, contentType = "text/html"): Response {
    return {
      ok: true,
      status: 200,
      headers: {
        get: (k: string) =>
          k.toLowerCase() === "content-type" ? contentType : null,
      },
      text: async () => html,
    } as unknown as Response;
  }

  function redirectResponse(location: string | null, status = 302): Response {
    return {
      ok: false,
      status,
      headers: {
        get: (k: string) => (k.toLowerCase() === "location" ? location : null),
      },
      text: async () => "",
    } as unknown as Response;
  }

  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows a redirect to an allowed SEFAZ host", async () => {
    fetchMock
      .mockResolvedValueOnce(
        redirectResponse("https://nfce.sefaz.go.gov.br/final"),
      )
      .mockResolvedValueOnce(htmlResponse("<table><tr><td>item</td></tr></table>"));

    const result = await fetchSefazPage("https://nfe.svrs.rs.gov.br/start");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://nfce.sefaz.go.gov.br/final");
    // Redirects are followed manually, not by the fetch layer.
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("refuses to follow a redirect to a non-SEFAZ host (SSRF)", async () => {
    fetchMock.mockResolvedValueOnce(
      redirectResponse("http://169.254.169.254/latest/meta-data"),
    );

    const result = await fetchSefazPage("https://nfe.svrs.rs.gov.br/start");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("SEFAZ");
    // Crucially, the metadata endpoint was never fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps the number of redirects", async () => {
    fetchMock.mockResolvedValue(
      redirectResponse("https://nfe.svrs.rs.gov.br/loop"),
    );

    const result = await fetchSefazPage("https://nfe.svrs.rs.gov.br/start");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("redirecionamentos");
  });

  it("rejects an initial URL outside the allowlist without fetching", async () => {
    const result = await fetchSefazPage("http://169.254.169.254/");

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
