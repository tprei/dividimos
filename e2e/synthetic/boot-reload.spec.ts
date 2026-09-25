import { test, expect } from "../fixtures";

test.describe("Group screen after hard reload", () => {
  test("renders group screen without stalling in skeleton across hard reloads", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Reload" });
    const group = await seed.createGroup(alice.id, [], "Grupo Reload Test");

    await loginAs(alice);
    await page.goto(`/app/groups/${group.id}`);

    await expect(page.getByRole("heading", { name: "Grupo Reload Test", level: 1 })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Grupo Reload Test", level: 1 })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Grupo Reload Test", level: 1 })).toBeVisible();
  });
});