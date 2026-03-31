import { describe, it, expect } from "vitest";
import manifest from "./manifest";

describe("manifest", () => {
  it("returns a valid PWA manifest with required fields", () => {
    const m = manifest();

    expect(m.name).toBe("Dividimos — Vamos dividir");
    expect(m.short_name).toBe("Dividimos");
    expect(m.start_url).toBe("/app");
    expect(m.display).toBe("standalone");
  });

  it("includes id field for Android installability", () => {
    const m = manifest();

    expect(m.id).toBe("ai.dividimos.app");
  });

  it("includes maskable icons for adaptive icon support", () => {
    const m = manifest();
    const maskable = m.icons?.filter((i) => i.purpose === "maskable");

    expect(maskable).toBeDefined();
    expect(maskable!.length).toBeGreaterThanOrEqual(1);
  });
});
