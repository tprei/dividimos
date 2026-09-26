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

    // Web Speech drives Chromium/Android; the iPhone project takes the
    // MediaRecorder engine, so both are stubbed here to deliver the same
    // transcript to /api/voice/parse.
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

      // WebKit's Linux build behind Playwright has no MediaStream constructor
      // and ignores a getUserMedia override on the MediaDevices instance, so
      // the whole mediaDevices object is replaced through the prototype.
      const track = { kind: "audio", enabled: true, stop() {} };
      const fakeStream = { getTracks: () => [track], getAudioTracks: () => [track] };
      const fakeMediaDevices = { getUserMedia: async () => fakeStream };
      Object.defineProperty(Navigator.prototype, "mediaDevices", {
        configurable: true,
        get: () => fakeMediaDevices,
      });

      class FakeMediaRecorder {
        static isTypeSupported(mimeType: string) {
          return ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].includes(mimeType);
        }
        state = "inactive";
        mimeType: string;
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(_stream: MediaStream, options?: { mimeType?: string }) {
          this.mimeType = options?.mimeType ?? "audio/webm";
        }
        start() {
          this.state = "recording";
          setTimeout(() => {
            if (this.state === "recording") this.stop();
          }, 150);
        }
        stop() {
          if (this.state === "inactive") return;
          this.state = "inactive";
          this.ondataavailable?.({
            data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }),
          });
          setTimeout(() => this.onstop?.(), 20);
        }
      }
      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: FakeMediaRecorder,
      });

      class FakeAudioContext {
        state = "running";
        sampleRate = 48000;
        destination = {};
        createMediaStreamSource() {
          return { connect() {}, disconnect() {} };
        }
        createAnalyser() {
          return {
            fftSize: 1024,
            getFloatTimeDomainData: (buffer: Float32Array) => {
              buffer.fill(0);
            },
          };
        }
        async close() {}
      }
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: FakeAudioContext,
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
    await page.route("**/api/voice/transcribe", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ transcript: TRANSCRIPT }),
      }),
    );

    await loginAs(alice, { navigate: false });
    await page.goto("/app/bill/new");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Falar conta/ }).click();

    const micButton = page.getByRole("button", { name: "Gravar conta" });
    await expect(micButton).toHaveCount(1);
    await micButton.click();

    const modal = page.getByText("Confirmar conta");
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
