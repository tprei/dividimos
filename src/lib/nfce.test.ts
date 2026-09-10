import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseSefazPage,
  parseBrlToCents,
  isAllowedSefazUrl,
  fetchSefazPage,
  normalizeAccessKey,
  extractSefazAccessKeys,
} from "./nfce";
const ACCESS_KEY = "35240199999999999999550010000001231234567890";
const OTHER_ACCESS_KEY = "91234567890123456789012345678901234567890123";

function bindReceiptIdentity(html: string, accessKey = ACCESS_KEY): string {
  const field = `<div id="chaveAcesso">${accessKey}</div>`;
  return /<body\b[^>]*>/i.test(html)
    ? html.replace(/<body\b[^>]*>/i, (match) => `${match}${field}`)
    : `<body>${field}${html}</body>`;
}

function parseBoundPage(html: string): ReturnType<typeof parseSefazPage> {
  return parseSefazPage(bindReceiptIdentity(html), ACCESS_KEY);
}

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
    expect(parseSefazPage("", ACCESS_KEY)).toBeNull();
  });

  it("returns null for HTML with no items", () => {
    const html = "<html><body><h1>Nota Fiscal</h1></body></html>";
    expect(parseBoundPage(html)).toBeNull();
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

    const result = parseBoundPage(html);
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

    const result = parseBoundPage(html);
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

    const result = parseBoundPage(html);
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

    expect(parseBoundPage(html)).toBeNull();
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

    const result = parseBoundPage(html);
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

    const result = parseBoundPage(html);
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

    const result = parseBoundPage(html);
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

    const result = parseBoundPage(html);
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

    const result = parseBoundPage(html);
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

    const result = parseBoundPage(html);
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
  function bodyOf(chunks: string[], cancel = vi.fn().mockResolvedValue(undefined)) {
    let i = 0;
    return {
      cancel,
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
            : { done: true, value: undefined },
        cancel,
        releaseLock: () => {},
      }),
    };
  }

  function htmlResponse(
    html: string,
    contentType = "text/html",
    chunks?: string[],
  ): Response {
    return {
      ok: true,
      status: 200,
      headers: {
        get: (k: string) =>
          k.toLowerCase() === "content-type" ? contentType : null,
      },
      body: bodyOf(chunks ?? [html]),
      text: async () => html,
    } as unknown as Response;
  }

  function redirectResponse(
    location: string | null,
    status = 302,
    cancel = vi.fn().mockResolvedValue(undefined),
  ): Response {
    return {
      ok: false,
      status,
      headers: {
        get: (k: string) => (k.toLowerCase() === "location" ? location : null),
      },
      body: bodyOf([""], cancel),
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

  it("never fetches plaintext, for the initial URL or a redirect hop", async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse("http://nfce.sefaz.go.gov.br/final"))
      .mockResolvedValueOnce(htmlResponse("<table><tr><td>item</td></tr></table>"));

    const result = await fetchSefazPage("http://nfe.svrs.rs.gov.br/start");

    expect(result.ok).toBe(true);
    // Both hops were upgraded: nothing on a fiscal portal goes in the clear.
    expect(fetchMock.mock.calls[0][0]).toBe("https://nfe.svrs.rs.gov.br/start");
    expect(fetchMock.mock.calls[1][0]).toBe("https://nfce.sefaz.go.gov.br/final");
  });

  it("cuts off a body that expands past the cap, before parsing it", async () => {
    // 3 MB in 512 KB chunks: the cap must trip mid-stream.
    const chunk = "x".repeat(512 * 1024);
    fetchMock.mockResolvedValueOnce(
      htmlResponse("", "text/html", Array.from({ length: 6 }, () => chunk)),
    );

    const result = await fetchSefazPage("https://nfe.svrs.rs.gov.br/start");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("tamanho");
  });

  it("cancels the body of an early exit", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => null },
      body: bodyOf([""], cancel),
      text: async () => "",
    } as unknown as Response);

    const result = await fetchSefazPage("https://nfe.svrs.rs.gov.br/start");

    expect(result.ok).toBe(false);
    // An abandoned stream would otherwise hold the connection open.
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects an initial URL outside the allowlist without fetching", async () => {
    const result = await fetchSefazPage("http://169.254.169.254/");

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe("normalizeAccessKey", () => {
  it("returns the bare digits for an already plain key", () => {
    expect(normalizeAccessKey(ACCESS_KEY)).toBe(ACCESS_KEY);
  });

  it("normalizes space-separated group formatting", () => {
    const formatted =
      "3524 0199 9999 9999 9999 5500 1000 0001 2312 3456 7890";
    expect(normalizeAccessKey(formatted)).toBe(ACCESS_KEY);
  });

  it("normalizes dot- and hyphen-separated formatting", () => {
    expect(
      normalizeAccessKey("3524.0199.9999.9999.9999.5500.1000.0001.2312.3456.7890"),
    ).toBe(ACCESS_KEY);
    expect(
      normalizeAccessKey("3524-0199-9999-9999-9999-5500-1000-0001-2312-3456-7890"),
    ).toBe(ACCESS_KEY);
  });

  it("rejects values that are not exactly one 44-digit identity", () => {
    expect(normalizeAccessKey("")).toBeNull();
    expect(normalizeAccessKey("1234")).toBeNull();
    expect(normalizeAccessKey("chave de acesso")).toBeNull();
    expect(normalizeAccessKey(`${ACCESS_KEY}9`)).toBeNull();
    expect(normalizeAccessKey(ACCESS_KEY.slice(1))).toBeNull();
  });
});

describe("extractSefazAccessKeys", () => {
  it("extracts a key from a dedicated label/span field", () => {
    const html = `<html><body><div><span>Chave de acesso:</span><span>${ACCESS_KEY}</span></div></body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([ACCESS_KEY]);
  });

  it("normalizes formatted keys inside the dedicated field", () => {
    const formatted =
      "3524 0199 9999 9999 9999 5500 1000 0001 2312 3456 7890";
    const html = `<html><body><div><span>Chave de acesso:</span><span>${formatted}</span></div></body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([ACCESS_KEY]);
  });

  it("extracts a key from a th/td label row", () => {
    const html = `<html><body><table><tr><th>Chave de acesso</th><td>${ACCESS_KEY}</td></tr></table></body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([ACCESS_KEY]);
  });

  it("extracts a key from an English dt/dd Access key pair", () => {
    const html = `<html><body><dl><dt>Access key</dt><dd>${ACCESS_KEY}</dd></dl></body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([ACCESS_KEY]);
  });

  it("extracts a key from a label followed by its value block", () => {
    const html = `<html><body><div class="form-group"><label for="chave">Chave de acesso</label><div class="valor">${ACCESS_KEY}</div></div></body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([ACCESS_KEY]);
  });

  it("extracts an inline label/value on one element", () => {
    const html = `<html><body><div>Chave de acesso: ${ACCESS_KEY}</div></body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([ACCESS_KEY]);
  });

  it("extracts a key from an attribute-keyed field (id/class)", () => {
    const html = `<html><body><div id="chaveAcesso">${ACCESS_KEY}</div><span class="nfce-chave">${ACCESS_KEY}</span></body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([ACCESS_KEY]);
  });

  it("de-duplicates the same key repeated across dedicated fields", () => {
    const html = `<html><body><div id="chaveAcesso">${ACCESS_KEY}</div><table><tr><th>Chave de acesso</th><td>${ACCESS_KEY}</td></tr></table></body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([ACCESS_KEY]);
  });

  it("returns every distinct dedicated key (ambiguous pages fail identity)", () => {
    const html = `<html><body><div id="chaveAcesso">${ACCESS_KEY}</div><div id="chaveAcesso2">${OTHER_ACCESS_KEY}</div></body></html>`;
    expect(extractSefazAccessKeys(html).sort()).toEqual(
      [ACCESS_KEY, OTHER_ACCESS_KEY].sort(),
    );
  });

  it("returns [] when no dedicated access-key field exists", () => {
    const html = `<html><body><table class="toggable"><tr><td>Item</td><td>1,000</td><td>10,00</td><td>10,00</td></tr></table><div>VALOR TOTAL R$ 10,00</div></body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([]);
  });

  it("rejects a key that appears only in free body text, links, or scripts", () => {
    const html = `<html><body>
      <p>A chave de acesso desta nota e ${ACCESS_KEY} e pode ser consultada no portal.</p>
      <a href="https://nfce.sefaz.sp.gov.br/consulta?chNFe=${ACCESS_KEY}">Consultar nota</a>
      <script>const chave = "${ACCESS_KEY}";</script>
      <table class="toggable"><tr><td>Item</td><td>1,000</td><td>10,00</td><td>10,00</td></tr></table>
      <div>VALOR TOTAL R$ 10,00</div>
    </body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([]);
  });

  it("ignores the expected key living only in the consultation URL text", () => {
    const html = `<html><body><p>Consulta: https://nfce.sefaz.sp.gov.br/consulta?chNFe=${ACCESS_KEY}</p></body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([]);
  });
  it("rejects generic or hidden attributes that are not fiscal identity fields", () => {
    const html = `<html><body>
      <input type="hidden" name="chave" value="${ACCESS_KEY}">
      <div class="chave-seguranca">${ACCESS_KEY}</div>
    </body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([]);
  });

  it("rejects keys nested in scripts or links inside a labeled row", () => {
    const html = `<html><body>
      <div class="row">
        <span>Chave de acesso</span>
        <a href="/consulta"> ${ACCESS_KEY} </a>
        <script>document.write("${ACCESS_KEY}")</script>
      </div>
    </body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([]);
  });

  it("reads a textarea fiscal access-key field", () => {
    const html = `<html><body><textarea id="chaveAcesso">${ACCESS_KEY}</textarea></body></html>`;
    expect(extractSefazAccessKeys(html)).toEqual([ACCESS_KEY]);
  });

  it("requires the expected identity before parsing receipt data", () => {
    const html = bindReceiptIdentity(`
      <table class="toggable">
        <tr><td>Item Teste</td><td>1,000</td><td>10,00</td><td>10,00</td></tr>
      </table>
      <div>VALOR TOTAL R$ 10,00</div>
    `);
    expect(parseSefazPage(html, ACCESS_KEY)).not.toBeNull();
    expect(parseSefazPage(html, OTHER_ACCESS_KEY)).toBeNull();
    expect(parseSefazPage(html, "")).toBeNull();
  });
});
