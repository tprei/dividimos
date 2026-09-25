import { test, expect } from "../fixtures";

test.describe("Theme persistence", () => {
  test("boot honors the system scheme and an explicit choice survives reloads", async ({
    page,
    seed,
    loginAs,
  }) => {
    const user = await seed.createUser({ name: "Tema Fontes" });

    await page.emulateMedia({ colorScheme: "dark" });
    await loginAs(user);
    await page.goto("/app/groups");
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/app/profile");
    await page.getByRole("switch", { name: "Modo escuro" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.goto("/app/groups");
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");

    await page.goto("/app/profile");
    await page.getByRole("switch", { name: "Modo escuro" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.goto("/app");
    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
  });
});
