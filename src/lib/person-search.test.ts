import { describe, expect, it } from "vitest";
import type { UserProfile } from "@/types/ledger";
import { foldForSearch, matchPeople, parseHandleQuery } from "./person-search";

function person(handle: string, name: string): UserProfile {
  return { id: `user-${handle}`, handle, name, avatarUrl: null, isBot: false };
}

describe("foldForSearch", () => {
  it("lowercases, folds accents and trims", () => {
    expect(foldForSearch("  João Silva  ")).toBe("joao silva");
    expect(foldForSearch("ÁÉÎÕÇ")).toBe("aeioc");
  });
});

describe("matchPeople", () => {
  it("matches accents-insensitively by folded name", () => {
    const people = [person("jsilva", "João Silva")];
    expect(matchPeople(people, "joao")).toEqual(people);
    expect(matchPeople(people, "silva")).toEqual(people);
  });

  it("matches when every token has a word-prefix match", () => {
    const people = [person("apsouza", "Ana Paula Souza")];
    expect(matchPeople(people, "paula s")).toEqual(people);
    expect(matchPeople(people, "ana paula")).toEqual(people);
    expect(matchPeople(people, "ana z")).toEqual([]);
  });

  it("matches word prefixes only, not infixes", () => {
    const people = [person("juliana", "Juliana Costa")];
    expect(matchPeople(people, "ana")).toEqual([]);
    expect(matchPeople(people, "jul")).toEqual(people);
  });

  it("matches a handle prefix and strips a leading @", () => {
    const people = [person("joaosilva", "João Silva")];
    expect(matchPeople(people, "joaosi")).toEqual(people);
    expect(matchPeople(people, "@joao")).toEqual(people);
  });

  it("matches handle prefixes only for a query starting with @", () => {
    const people = [person("paula", "Ana Paula")];
    expect(matchPeople(people, "@ana")).toEqual([]);
    expect(matchPeople(people, "@paula")).toEqual(people);
  });

  it("orders exact-handle matches first", () => {
    const first = person("joaopedro", "João Pedro");
    const exact = person("joao", "Zé do Poste");
    expect(matchPeople([first, exact], "joao")).toEqual([exact, first]);
  });

  it("returns nothing for an empty query", () => {
    const people = [person("joao", "João")];
    expect(matchPeople(people, "")).toEqual([]);
    expect(matchPeople(people, "   ")).toEqual([]);
    expect(matchPeople(people, "@")).toEqual([]);
  });
});

describe("parseHandleQuery", () => {
  it("treats a leading @ as explicit intent", () => {
    expect(parseHandleQuery("@bob")).toEqual({ kind: "explicit", handle: "bob" });
  });

  it("treats underscores as explicit intent", () => {
    expect(parseHandleQuery("bob_test")).toEqual({ kind: "explicit", handle: "bob_test" });
  });

  it("treats digits as explicit intent", () => {
    expect(parseHandleQuery("ana2")).toEqual({ kind: "explicit", handle: "ana2" });
  });

  it("treats a plain word as implicit intent", () => {
    expect(parseHandleQuery("joao")).toEqual({ kind: "implicit", handle: "joao" });
  });

  it("rejects candidates shorter than three characters", () => {
    expect(parseHandleQuery("jo")).toEqual({ kind: "none" });
  });

  it("rejects queries with whitespace", () => {
    expect(parseHandleQuery("ana paula")).toEqual({ kind: "none" });
  });

  it("rejects a bare @", () => {
    expect(parseHandleQuery("@")).toEqual({ kind: "none" });
  });
});
