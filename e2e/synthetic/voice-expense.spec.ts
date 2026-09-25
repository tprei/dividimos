import { test, expect } from "../fixtures";

const TRANSCRIPT = "Uber com João 25 reais";

test.describe("Voice expense", () => {
  test("transcribed speech fills the wizard through the parse route", async ({
    page,
    context,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Voice" });

    // A deterministic stand-in for the browser recognizer: start() emits the
    // final transcript and ends the session, exactly what the hook consumes.
    await context.addInitScript((text: string) => {
      class FakeSpeechRecognition {
        lang = "";
        continuous = false;
        interimResults = false;
        maxAlternatives = 1;
        onresult: ((event: { resultIndex: number; results: unknown[] }) => void) | null = null;
        onerror: ((event: { error: string }) => void) | null = null;
        onend: (() => void) | null = null;
        onstart: (() => void) | null = null;
        start() {
          setTimeout(() => {
            this.onstart?.();
            this.onresult?.({
              resultIndex: 0,
              results: [{ 0: { transcript: text }, isFinal: true, length: 1 }],
            });
            setTimeout(() => this.onend?.(), 80);
          }, 60);
        }
        stop() {}
        abort() {}
      }
      Object.defineProperty(window, "SpeechRecognition", {
        configurable: true,
        value: FakeSpeechRecognition,
      });
    }, TRANSCRIPT);

    await page.route("**/api/voice/parse", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          title: "Uber",
          amountCents: 2500,
          expenseType: "single_amount",
          items: [],
          participants: [],
          merchantName: null,
        }),
      }),
    );

    await loginAs(alice, { navigate: false });
    await page.goto("/app/bill/new");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Falar despesa/ }).click();

    const micButton = page.getByRole("button", { name: "Gravar despesa" });
    await expect(micButton).toHaveCount(1);
    await micButton.click();

    const modal = page.getByText("Confirmar despesa");
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Uber", { exact: true })).toBeVisible();
    await expect(page.getByText("R$ 25,00")).toBeVisible();
    await expect(page.getByText("Valor único")).toBeVisible();

    await page.getByRole("button", { name: "Confirmar" }).click();

    await expect(page.getByLabel("Nome da conta")).toHaveValue("Uber", { timeout: 10000 });
    await page.getByRole("button", { name: "Adicionar convidado" }).click();
    await page.getByPlaceholder("Nome do convidado").fill("Carla");
    await page.getByPlaceholder("Nome do convidado").press("Enter");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByLabel("Valor total")).toHaveValue("25,00");
  });
});
