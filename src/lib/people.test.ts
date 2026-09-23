import { describe, expect, it } from "vitest";
import {
  avatarToneIndex,
  displayNames,
  firstNameOf,
  initialsOf,
  sentenceStart,
  type PersonRef,
} from "./people";

describe("initialsOf", () => {
  it("uses first and last token initials, skipping PT particles", () => {
    expect(initialsOf("Tiago Rocha")).toBe("TR");
    expect(initialsOf("Maria da Silva")).toBe("MS");
    expect(initialsOf("Maria Eduarda dos Santos Albuquerque")).toBe("MA");
    expect(initialsOf("João Pedro Almeida")).toBe("JA");
  });

  it("splits hyphenated tokens", () => {
    expect(initialsOf("Jean-Paul")).toBe("JP");
    expect(initialsOf("Jean-Paul Sartre")).toBe("JS");
  });

  it("falls back to the first-token rule when only particles follow", () => {
    expect(initialsOf("Maria da")).toBe("MA");
    expect(initialsOf("Lucas de")).toBe("LU");
  });

  it("uses the first two letters of a single token", () => {
    expect(initialsOf("Ana")).toBe("AN");
    expect(initialsOf("Jo")).toBe("JO");
    expect(initialsOf("J")).toBe("J");
  });

  it("normalizes NFD input before picking initials", () => {
    expect(initialsOf("E\u0301der")).toBe("ÉD");
    expect(initialsOf("E\u0301der Silva")).toBe("ÉS");
  });

  it("returns the emoji grapheme when the name has no letters or digits", () => {
    expect(initialsOf("🍕")).toBe("🍕");
  });

  it("asks for a name when there is none", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});

describe("firstNameOf", () => {
  it("returns the first whitespace-separated token", () => {
    expect(firstNameOf("  Ana Paula  ")).toBe("Ana");
  });

  it("returns empty for a blank name", () => {
    expect(firstNameOf("   ")).toBe("");
  });
});

describe("displayNames", () => {
  it("uses first names and disambiguates same first names by last initial", () => {
    const people: PersonRef[] = [
      { id: "1", name: "João Silva" },
      { id: "2", name: "João Almeida" },
      { id: "3", name: "Ana" },
    ];
    expect(displayNames(people, { style: "short" })).toEqual(
      new Map([
        ["1", "João S."],
        ["2", "João A."],
        ["3", "Ana"],
      ]),
    );
  });

  it("skips particles when picking the disambiguating initial", () => {
    const people: PersonRef[] = [
      { id: "1", name: "Maria da Silva" },
      { id: "2", name: "Maria de Albuquerque" },
    ];
    expect(displayNames(people, { style: "short" })).toEqual(
      new Map([
        ["1", "Maria S."],
        ["2", "Maria A."],
      ]),
    );
  });

  it("treats accented and plain first names as the same", () => {
    const people: PersonRef[] = [
      { id: "1", name: "Éder Silva" },
      { id: "2", name: "Eder Lopes" },
    ];
    expect(displayNames(people, { style: "short" })).toEqual(
      new Map([
        ["1", "Éder S."],
        ["2", "Eder L."],
      ]),
    );
  });

  it("falls back to full names when first and last initials also collide", () => {
    const people: PersonRef[] = [
      { id: "1", name: "João Silva" },
      { id: "2", name: "João Santos" },
    ];
    expect(displayNames(people, { style: "short" })).toEqual(
      new Map([
        ["1", "João Silva"],
        ["2", "João Santos"],
      ]),
    );
  });

  it("keeps the full name for single-token people sharing a first name", () => {
    const people: PersonRef[] = [
      { id: "1", name: "João" },
      { id: "2", name: "João Silva" },
    ];
    expect(displayNames(people, { style: "short" })).toEqual(
      new Map([
        ["1", "João"],
        ["2", "João S."],
      ]),
    );
  });

  it("disambiguates identical full names with handle, guest marker, then ordinal", () => {
    const people: PersonRef[] = [
      { id: "1", name: "Lucas Rocha", handle: "lucas" },
      { id: "2", name: "Lucas Rocha", isGuest: true },
      { id: "3", name: "Lucas Rocha" },
      { id: "4", name: "Lucas Rocha" },
    ];
    expect(displayNames(people, { style: "short" })).toEqual(
      new Map([
        ["1", "Lucas Rocha (@lucas)"],
        ["2", "Lucas Rocha (convidado)"],
        ["3", "Lucas Rocha"],
        ["4", "Lucas Rocha 2"],
      ]),
    );
  });

  it("numbers guests that stay identical after the convidado marker", () => {
    const people: PersonRef[] = [
      { id: "1", name: "Ana", isGuest: true },
      { id: "2", name: "Ana", isGuest: true },
    ];
    expect(displayNames(people, { style: "short" })).toEqual(
      new Map([
        ["1", "Ana (convidado)"],
        ["2", "Ana (convidado) 2"],
      ]),
    );
  });

  it("uses full names in full style and disambiguates collisions the same way", () => {
    const people: PersonRef[] = [
      { id: "1", name: "Bruna Lima" },
      { id: "2", name: "Bruna Lima", handle: "bruna" },
      { id: "3", name: "Carlos" },
    ];
    expect(displayNames(people, { style: "full" })).toEqual(
      new Map([
        ["1", "Bruna Lima"],
        ["2", "Bruna Lima (@bruna)"],
        ["3", "Carlos"],
      ]),
    );
  });

  it("labels the viewer and ignores duplicates", () => {
    const people: PersonRef[] = [
      { id: "me", name: "Ana Silva" },
      { id: "me", name: "Ana Silva" },
      { id: "other", name: "Ana Souza" },
    ];
    expect(displayNames(people, { style: "short", viewerId: "me" })).toEqual(
      new Map([
        ["me", "Você"],
        ["other", "Ana"],
      ]),
    );
  });

  it("honors a custom self label", () => {
    const people: PersonRef[] = [{ id: "me", name: "Ana" }];
    expect(displayNames(people, { style: "short", viewerId: "me", selfLabel: "Tu" })).toEqual(
      new Map([["me", "Tu"]]),
    );
  });
});

describe("avatarToneIndex", () => {
  it("is stable for the same id and stays within the 8 tones", () => {
    expect(avatarToneIndex("user-42")).toBe(avatarToneIndex("user-42"));
    const tones = new Set(
      Array.from({ length: 200 }, (_, i) => avatarToneIndex("id-" + i)),
    );
    for (const tone of tones) {
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThanOrEqual(7);
    }
  });

  it("spreads ids across tones", () => {
    const tones = new Set(Array.from({ length: 40 }, (_, i) => avatarToneIndex("id-" + i)));
    expect(tones.size).toBeGreaterThan(1);
  });
});

describe("sentenceStart", () => {
  it("uppercases the first grapheme", () => {
    expect(sentenceStart("você")).toBe("Você");
    expect(sentenceStart("alguém")).toBe("Alguém");
  });

  it("leaves already-capitalized and empty labels alone", () => {
    expect(sentenceStart("Alguém")).toBe("Alguém");
    expect(sentenceStart("")).toBe("");
  });
});
