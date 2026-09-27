import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { ITEM_ICON_HINTS, isItemIconKey } from "./item-icons";

describe("item icon assets", () => {
  it("has one SVG for every hint key and no unlisted SVGs", () => {
    const assetKeys = readdirSync(new URL("../../public/item-icons/", import.meta.url))
      .filter((file) => file.endsWith(".svg"))
      .map((file) => basename(file, ".svg"))
      .sort();

    expect(assetKeys).toEqual(Object.keys(ITEM_ICON_HINTS).sort());
  });

  it("uses only keys the database accepts", () => {
    expect(Object.keys(ITEM_ICON_HINTS).filter((key) => !isItemIconKey(key))).toEqual([]);
  });
});
