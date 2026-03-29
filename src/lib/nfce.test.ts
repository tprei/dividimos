import { describe, it, expect } from "vitest";
import { parseSefazPage, parseBrlToCents } from "./nfce";

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
    expect(result!.serviceFeePercent).toBe(0);
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

  it("calculates total from items when page total is missing", () => {
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

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.totalCents).toBe(350 + 900);
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
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.items[0].description).toBe("Coca Cola 2L");
  });

  it("serviceFeePercent is 0 when no service fee present", () => {
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
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.serviceFeePercent).toBe(0);
  });

  it("extracts service fee percentage from explicit text", () => {
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
    expect(result!.serviceFeePercent).toBe(10);
  });

  it("extracts service fee percentage from lowercase text", () => {
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
      </body></html>
    `;

    const result = parseSefazPage(html);
    expect(result).not.toBeNull();
    expect(result!.serviceFeePercent).toBe(12);
  });

  it("derives service fee percentage from monetary value and subtotal", () => {
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
    expect(result!.serviceFeePercent).toBe(10);
  });
});
