import { describe, expect, it } from "vitest";
import { compareNativeBuild } from "./native-version";

const minimums = { android: 10, ios: 20 };

describe("compareNativeBuild", () => {
  it("requires an update below the platform minimum", () => {
    expect(compareNativeBuild("android", "9", minimums)).toBe("update-required");
    expect(compareNativeBuild("ios", "19", minimums)).toBe("update-required");
  });

  it("accepts an equal or greater installed build", () => {
    expect(compareNativeBuild("android", "10", minimums)).toBe("supported");
    expect(compareNativeBuild("android", "11", minimums)).toBe("supported");
    expect(compareNativeBuild("android", "100", minimums)).toBe("supported");
    expect(compareNativeBuild("ios", "20", minimums)).toBe("supported");
  });

  it.each([
    "",
    " ",
    "abc",
    "12abc",
    "-1",
    "+10",
    "1.2",
    "1e2",
    "0x10",
    "Infinity",
    "NaN",
    " 10 ",
    "9007199254740992",
  ])("rejects the malformed active build value %j", (build) => {
    expect(compareNativeBuild("android", build, minimums)).toBe("invalid-build");
    expect(compareNativeBuild("ios", build, minimums)).toBe("invalid-build");
  });

  it("accepts decimal builds with leading zeroes", () => {
    expect(compareNativeBuild("android", "0010", minimums)).toBe("supported");
  });

  it("compares zero as a valid installed build", () => {
    expect(compareNativeBuild("android", "0", minimums)).toBe("update-required");
  });

  it("does not enforce native minimums on web", () => {
    expect(compareNativeBuild("web", "not-a-build", minimums)).toBe("supported");
  });

  it("disables a platform guard when its minimum is zero", () => {
    const dormant = { android: 0, ios: 20 };
    expect(compareNativeBuild("android", "still-malformed", dormant)).toBe("supported");
    expect(compareNativeBuild("ios", "19", dormant)).toBe("update-required");
  });
});
