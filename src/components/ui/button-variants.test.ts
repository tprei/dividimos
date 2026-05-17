import { describe, it, expect } from "vitest"
import { buttonVariants } from "./button-variants"

describe("buttonVariants", () => {
  it("returns a non-empty string for default variant", () => {
    const result = buttonVariants({ variant: "default" })
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })

  it("returns a non-empty string for each named variant", () => {
    const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const
    for (const variant of variants) {
      expect(buttonVariants({ variant }).length).toBeGreaterThan(0)
    }
  })

  it("returns a non-empty string for each size", () => {
    const sizes = ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] as const
    for (const size of sizes) {
      expect(buttonVariants({ size }).length).toBeGreaterThan(0)
    }
  })
})
