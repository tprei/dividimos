import { describe, expect, it } from "vitest";
import {
  INTRO_DEFAULT_SHARERS,
  INTRO_ITEMS,
  INTRO_PEOPLE,
  INTRO_SERVICE_CENTS,
  INTRO_TOTAL_CENTS,
  splitIntroBill,
  type IntroItemId,
  type IntroPersonId,
  type IntroSharers,
} from "./intro-demo-bill";

const SUBSETS: readonly (readonly IntroPersonId[])[] = [
  ["voce"],
  ["bia"],
  ["leo"],
  ["voce", "bia"],
  ["voce", "leo"],
  ["bia", "leo"],
  ["voce", "bia", "leo"],
];

function* everyAssignment(): Generator<IntroSharers> {
  const ids = INTRO_ITEMS.map((item) => item.id);
  const picks = ids.map(() => 0);
  while (true) {
    const sharers: Record<IntroItemId, readonly IntroPersonId[]> = { ...INTRO_DEFAULT_SHARERS };
    ids.forEach((id, index) => {
      sharers[id] = SUBSETS[picks[index]];
    });
    yield sharers;
    let position = 0;
    while (position < picks.length && picks[position] === SUBSETS.length - 1) {
      picks[position] = 0;
      position += 1;
    }
    if (position === picks.length) return;
    picks[position] += 1;
  }
}

describe("intro demo bill", () => {
  it("prices the receipt shown in the story", () => {
    expect(INTRO_SERVICE_CENTS).toBe(1118);
    expect(INTRO_TOTAL_CENTS).toBe(12298);
  });

  it("splits the default assignment into the amounts the story charges", () => {
    const split = splitIntroBill(INTRO_DEFAULT_SHARERS);

    expect(split.serviceCents).toEqual({ voce: 309, bia: 430, leo: 379 });
    expect(split.totalCents).toEqual({ voce: 3399, bia: 4730, leo: 4169 });
    expect(split.unassignedCents).toBe(0);
  });

  it("always adds up to the bill, to the centavo, for every assignment", () => {
    let checked = 0;
    for (const sharers of everyAssignment()) {
      const split = splitIntroBill(sharers);
      const total = INTRO_PEOPLE.reduce((sum, person) => sum + split.totalCents[person.id], 0);
      const service = INTRO_PEOPLE.reduce((sum, person) => sum + split.serviceCents[person.id], 0);

      expect(split.unassignedCents).toBe(0);
      expect(service).toBe(INTRO_SERVICE_CENTS);
      expect(total).toBe(INTRO_TOTAL_CENTS);
      checked += 1;
    }
    expect(checked).toBe(SUBSETS.length ** INTRO_ITEMS.length);
  });

  it("holds the service back while an item has nobody", () => {
    const split = splitIntroBill({ ...INTRO_DEFAULT_SHARERS, caipirinha: [] });
    const subtotal = INTRO_PEOPLE.reduce((sum, person) => sum + split.subtotalCents[person.id], 0);

    expect(split.unassignedCents).toBe(1800);
    expect(split.serviceCents).toEqual({ voce: 0, bia: 0, leo: 0 });
    expect(subtotal + split.unassignedCents).toBe(INTRO_TOTAL_CENTS - INTRO_SERVICE_CENTS);
  });

  it("gives the leftover centavo to the first person in the table, whatever order they were tapped", () => {
    const tappedBackwards = splitIntroBill({ ...INTRO_DEFAULT_SHARERS, guarana: ["leo", "bia", "voce"] });
    const tappedForwards = splitIntroBill({ ...INTRO_DEFAULT_SHARERS, guarana: ["voce", "bia", "leo"] });
    const withoutGuarana = splitIntroBill({ ...INTRO_DEFAULT_SHARERS, guarana: ["bia"] });

    expect(tappedBackwards).toEqual(tappedForwards);
    expect(tappedBackwards.subtotalCents.voce - withoutGuarana.subtotalCents.voce).toBe(234);
  });
});
