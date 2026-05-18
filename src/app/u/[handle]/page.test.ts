import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

describe("/u/[handle] page", () => {
  it("does not import createAdminClient", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf-8");
    expect(source).not.toContain("createAdminClient");
  });

  it("uses lookup_user_by_handle RPC for profile lookup", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf-8");
    expect(source).toContain("lookup_user_by_handle");
  });
});
