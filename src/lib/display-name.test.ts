import { describe, expect, it } from "vitest";
import { displayName } from "./display-name";

describe("displayName", () => {
  it("returns first name when no collision", () => {
    const user = { name: "Alice Silva", handle: "alice" };
    const all = [{ name: "Alice Silva" }, { name: "Bob Santos" }];
    expect(displayName(user, all)).toBe("Alice");
  });

  it("returns first name + handle when first name collides", () => {
    const user = { name: "Alice Lima", handle: "alimalice" };
    const all = [{ name: "Alice Lima" }, { name: "Alice Silva" }];
    expect(displayName(user, all)).toBe("Alice (@alimalice)");
  });

  it("returns first name without handle when collision exists but user has no handle", () => {
    const user = { name: "Alice Lima" };
    const all = [{ name: "Alice Lima" }, { name: "Alice Silva" }];
    expect(displayName(user, all)).toBe("Alice");
  });

  it("returns first name for single participant", () => {
    const user = { name: "Alice Silva", handle: "alice" };
    expect(displayName(user, [{ name: "Alice Silva" }])).toBe("Alice");
  });

  it("extracts first word from multi-word name", () => {
    const user = { name: "Maria Clara Santos", handle: "mariaclara" };
    const all = [{ name: "Maria Clara Santos" }, { name: "Bob Santos" }];
    expect(displayName(user, all)).toBe("Maria");
  });

  it("appends handle for each user when all share same first name", () => {
    const alice1 = { name: "Alice Lima", handle: "alice1" };
    const alice2 = { name: "Alice Silva", handle: "alice2" };
    const all = [{ name: "Alice Lima" }, { name: "Alice Silva" }];
    expect(displayName(alice1, all)).toBe("Alice (@alice1)");
    expect(displayName(alice2, all)).toBe("Alice (@alice2)");
  });
});
