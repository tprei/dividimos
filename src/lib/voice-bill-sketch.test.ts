import { describe, expect, it } from "vitest";
import { sketchVoiceBill } from "./voice-bill-sketch";

describe("sketchVoiceBill", () => {
  it("reads what, how much and with whom from a spoken bill", () => {
    expect(sketchVoiceBill("Uber com João, 25 reais")).toEqual({
      title: "Uber",
      amountCents: 2500,
      people: ["João"],
      headcount: null,
      payer: null,
    });
  });

  it("never mistakes the headcount for the amount", () => {
    const sketch = sketchVoiceBill("Pizza 80 dividido em 4");
    expect(sketch.amountCents).toBe(8000);
    expect(sketch.headcount).toBe(4);
    expect(sketchVoiceBill("dividido entre 3, jantar 90").amountCents).toBe(9000);
  });

  it("recognises who paid", () => {
    expect(sketchVoiceBill("Mercado 120, paguei eu")).toMatchObject({ title: "Mercado", amountCents: 12000, payer: "me" });
    expect(sketchVoiceBill("bar com Ana e Bia 150 a Ana pagou").payer).toBe("Ana");
    expect(sketchVoiceBill("bar com Ana e Bia 150").people).toEqual(["Ana", "Bia"]);
  });

  it("keeps reais and centavos apart and caps absurd numbers", () => {
    expect(sketchVoiceBill("R$ 1.234,5 no mercado")).toMatchObject({ amountCents: 123_450, title: "Mercado" });
    expect(sketchVoiceBill("café 7,90").amountCents).toBe(790);
    expect(sketchVoiceBill("conta 9999999999").amountCents).toBeNull();
  });

  it("leaves fields blank while nothing matching has been said", () => {
    expect(sketchVoiceBill("")).toEqual({ title: null, amountCents: null, people: [], headcount: null, payer: null });
    expect(sketchVoiceBill("uber com").people).toEqual([]);
  });
});
