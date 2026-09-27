import { test, expect } from "../fixtures";

test.describe("AI consent", () => {
  test("decline keeps manual expense entry and plain chat usable", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Consent" });
    const bob = await seed.createUser({ name: "Bob Consent" });
    await seed.createDmGroup(alice, bob);

    const aiRequests: string[] = [];
    page.on("request", (request) => {
      if (
        /\/api\/(chat\/parse|receipt\/ocr|voice\/(parse|transcribe))/.test(
          request.url(),
        )
      ) {
        aiRequests.push(request.url());
      }
    });

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    // A fresh account has no consent: entering AI mode must ask first.
    await page.getByTestId("sparkle-toggle").click();
    await expect(page.getByText("Usar IA no Dividimos?")).toBeVisible();
    expect(aiRequests).toEqual([]);

    await page.getByRole("button", { name: "Continuar sem IA" }).click();
    await expect(page.getByText("Usar IA no Dividimos?")).toHaveCount(0);

    // Plain chat still sends without any AI request.
    await page.getByTestId("chat-input").fill("fala galera");
    await page.getByTestId("send-button").click();
    await expect(page.getByTestId("chat-input")).toHaveValue("");
    expect(aiRequests).toEqual([]);

    // The scan deep link asks too, and declining leaves the manual types.
    await page.goto("/app/bill/new?scan=true");
    await expect(page.getByText("Usar IA no Dividimos?")).toBeVisible();
    await page.getByRole("button", { name: "Continuar sem IA" }).click();
    await expect(page.getByText("Que tipo de conta?")).toBeVisible();
    expect(aiRequests).toEqual([]);
  });

  test("grant is restored by bootstrap and revoke blocks the next AI request", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Grant" });
    const bob = await seed.createUser({ name: "Bob Grant" });
    await seed.createDmGroup(alice, bob);

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByTestId("sparkle-toggle").click();
    await page.getByRole("button", { name: "Permitir uso de IA" }).click();
    await expect(
      page.getByText("Permissão salva. Toque de novo no recurso para continuar."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Voltar" }).click();
    await expect(page.getByText("Usar IA no Dividimos?")).toHaveCount(0);

    // Saving consent never replays the action: the composer is still in
    // normal mode, and the next tap enters AI mode directly.
    await expect(page.getByTestId("sparkle-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.getByTestId("sparkle-toggle").click();
    await expect(page.getByTestId("sparkle-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // The grant survives a reload through the bootstrap me payload.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByTestId("sparkle-toggle").click();
    await expect(page.getByText("Usar IA no Dividimos?")).toHaveCount(0);
    await expect(page.getByTestId("sparkle-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Revoking in Settings brings the ask back before the next AI request.
    await page.goto("/app/settings");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Revogar permissão" }).click();
    await page
      .getByRole("button", { name: "Revogar permissão" })
      .last()
      .click();
    await expect(page.getByText("Uso de IA não permitido")).toBeVisible();

    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("sparkle-toggle").click();
    await expect(page.getByText("Usar IA no Dividimos?")).toBeVisible();
  });

  test("switching accounts on one device asks the new account again", async ({
    page,
    context,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Switch" });
    const bob = await seed.createUser({ name: "Bob Switch" });
    const carol = await seed.createUser({ name: "Carol Switch" });
    await seed.createDmGroup(alice, bob);
    await seed.createDmGroup(carol, bob);

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByTestId("sparkle-toggle").click();
    await page.getByRole("button", { name: "Permitir uso de IA" }).click();
    await expect(
      page.getByText("Permissão salva. Toque de novo no recurso para continuar."),
    ).toBeVisible();

    // The same browser context now belongs to another account.
    await context.clearCookies();
    await loginAs(carol);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByTestId("sparkle-toggle").click();
    await expect(page.getByText("Usar IA no Dividimos?")).toBeVisible();
  });
});
