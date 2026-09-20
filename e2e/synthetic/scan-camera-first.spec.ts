import { test, expect } from "../fixtures";

test.describe("Escanear nota goes straight to the camera", () => {
  test("shows no Camera/Galeria chooser page", async ({ page, seed, loginAs }) => {
    const alice = await seed.createUser({ name: "Alice Scanner" });

    await loginAs(alice);
    await page.goto("/app/bill/new?scan=true");

    // The chooser page and its duplicated header are gone entirely.
    await expect(page.getByText("Tire uma foto ou escolha da galeria.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Escanear nota" })).toHaveCount(0);

    // Whether the camera starts or the browser refuses it, the gallery
    // hand-off and a way out are always on screen.
    await expect(page.getByRole("button", { name: "Galeria" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Fechar" }).or(page.getByRole("button", { name: "Voltar" })).first(),
    ).toBeVisible();
  });
});
