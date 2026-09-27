import { describe, expect, it } from "vitest";
import { roomJoinFirstName } from "./room-join-name";

describe("roomJoinFirstName", () => {
  it.each([
    ["Berg, Silva", "Berg"],
    ["  André... Silva  ", "André"],
    ["“Bia!” Costa", "Bia"],
    ["Jean-Pierre Silva", "Jean-Pierre"],
    ["D’Ávila Santos", "D’Ávila"],
    ["Jose\u0301, Silva", "Jose\u0301"],
    ["李 雷", "李"],
    ["!!! Silva", null],
    ["   ", null],
    [null, null],
  ])("derives a usable greeting from %j", (name, expected) => {
    expect(roomJoinFirstName(name)).toBe(expected);
  });
});
