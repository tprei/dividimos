import { describe, expect, it } from "vitest";
import { describeDemoSplit, parseDemoExpense } from "@/lib/landing-expense-draft";

describe("parseDemoExpense", () => {
  it.each([
    ["uber 48 com bia e caio", { title: "Uber", cents: 4800, people: 3, names: ["bia", "caio"] }],
    ["mercado 86,40 com a carla", { title: "Mercado", cents: 8640, people: 2, names: ["carla"] }],
    ["pizza 90 em 3", { title: "Pizza", cents: 9000, people: 3, names: [] }],
    ["jantar 120 dividido em 4", { title: "Jantar", cents: 12000, people: 4, names: [] }],
    ["uber 32 reais com o Bruno", { title: "Uber", cents: 3200, people: 2, names: ["bruno"] }],
    ["pizza 90 reais em 3", { title: "Pizza", cents: 9000, people: 3, names: [] }],
    ["churrasco 240 reais entre 6", { title: "Churrasco", cents: 24000, people: 6, names: [] }],
    ["mercado 86 reais, divide com a Carla", { title: "Mercado", cents: 8600, people: 2, names: ["carla"] }],
    ["churrasco 240 com joão, bia e caio", { title: "Churrasco", cents: 24000, people: 4, names: ["joão", "bia", "caio"] }],
    ["aluguel 1.250,00 em 5", { title: "Aluguel", cents: 125000, people: 5, names: [] }],
    ["uber 48.90 com bia", { title: "Uber", cents: 4890, people: 2, names: ["bia"] }],
    ["cinema R$ 45,5 pra 2", { title: "Cinema", cents: 4550, people: 2, names: [] }],
    ["100 em 3", { title: "Despesa", cents: 10000, people: 3, names: [] }],
  ])("reads %s", (text, expected) => {
    expect(parseDemoExpense(text)).toEqual(expected);
  });

  it("accepts the expense cap and rejects one centavo more", () => {
    expect(parseDemoExpense("carro 999.999,99")?.cents).toBe(99_999_999);
    expect(parseDemoExpense("carro 1.000.000,00")).toBeNull();
  });

  it("rejects text without an amount or with a zero amount", () => {
    expect(parseDemoExpense("jantar com a bia")).toBeNull();
    expect(parseDemoExpense("jantar 0 em 2")).toBeNull();
  });

  it("caps the number of people at 20", () => {
    expect(parseDemoExpense("festa 500 em 99")?.people).toBe(20);
  });

  it("counts every companion, not only the ones shown", () => {
    expect(parseDemoExpense("rodízio 900 com a, b, c, d, e, f, g, h e i")?.people).toBe(10);
  });
});

describe("describeDemoSplit", () => {
  it("splits evenly when the amount divides", () => {
    expect(describeDemoSplit({ title: "Pizza", cents: 9000, people: 3, names: [] })).toBe(
      "3 pessoas · R$\u00a030,00 cada",
    );
  });

  it("shows the range when a centavo is left over", () => {
    expect(describeDemoSplit({ title: "Despesa", cents: 10000, people: 3, names: [] })).toBe(
      "3 pessoas · R$\u00a033,33 a R$\u00a033,34 cada",
    );
  });

  it("says it's only you for one person", () => {
    expect(describeDemoSplit({ title: "Café", cents: 800, people: 1, names: [] })).toBe("Só você");
  });
});
