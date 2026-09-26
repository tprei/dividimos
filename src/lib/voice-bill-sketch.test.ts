import { describe, expect, it } from "vitest";
import { sketchVoiceBill } from "./voice-bill-sketch";

describe("sketchVoiceBill", () => {
  it("reads what, how much and with whom from a spoken bill", () => {
    expect(sketchVoiceBill("Uber com João, 25 reais")).toEqual({
      title: "Uber",
      amountCents: 2500,
      people: ["João"],
    });
  });

  it("never mistakes a quantity or a count for the amount", () => {
    expect(sketchVoiceBill("2 cervejas 20 reais").amountCents).toBe(2000);
    expect(sketchVoiceBill("Pizza 80 dividido em 4").amountCents).toBe(8000);
    expect(sketchVoiceBill("dividido entre 3, jantar 90").amountCents).toBe(9000);
  });

  it("reads reais, centavos and por-extenso amounts", () => {
    expect(sketchVoiceBill("25 reais e 50 no bar").amountCents).toBe(2550);
    expect(sketchVoiceBill("café 7 e 90").amountCents).toBe(790);
    expect(sketchVoiceBill("café 7,90").amountCents).toBe(790);
    expect(sketchVoiceBill("Almoço 25.50").amountCents).toBe(2550);
    expect(sketchVoiceBill("jantar 1.5").amountCents).toBe(150);
    expect(sketchVoiceBill("R$ 1.234,56").amountCents).toBe(123456);
    expect(sketchVoiceBill("R$ 1.234,5 no mercado")).toMatchObject({ amountCents: 123_450, title: "Mercado" });
    expect(sketchVoiceBill("vinte e cinco reais uber")).toMatchObject({ amountCents: 2500, title: "Uber" });
    expect(sketchVoiceBill("Mercado 120 e cinquenta").amountCents).toBe(12050);
    expect(sketchVoiceBill("cinco reais e cinquenta centavos").amountCents).toBe(550);
  });

  it("refuses to guess ambiguous or absurd numbers", () => {
    expect(sketchVoiceBill("conta 12,345").amountCents).toBeNull();
    expect(sketchVoiceBill("conta 9999999999").amountCents).toBeNull();
  });

  it("reads names and stops at payment talk and known nouns", () => {
    expect(sketchVoiceBill("taxi 25 com joão e paguei eu").people).toEqual(["João"]);
    expect(sketchVoiceBill("com o joão uber 25").people).toEqual(["João"]);
    expect(sketchVoiceBill("bar com Ana e Bia 150").people).toEqual(["Ana", "Bia"]);
    expect(sketchVoiceBill("pizza 30 com ana e ana").people).toEqual(["Ana"]);
    expect(sketchVoiceBill("com joão e a maria 40").people).toEqual(["João", "Maria"]);
  });

  it("leaves fields blank while nothing matching has been said", () => {
    expect(sketchVoiceBill("")).toEqual({ title: null, amountCents: null, people: [] });
    expect(sketchVoiceBill("uber com").people).toEqual([]);
    expect(sketchVoiceBill("com vinte pessoas")).toEqual({ title: null, amountCents: null, people: [] });
  });
});
