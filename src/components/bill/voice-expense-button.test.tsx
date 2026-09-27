import { describe, expect, it, vi, beforeEach } from "vitest";
import { CURRENT_AI_CONSENT_VERSION } from "@/lib/ai-consent";
import { useAppStore } from "@/stores/app-store";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceExpenseButton } from "./voice-expense-button";
import type * as AiConsentSync from "@/lib/sync/ai-consent";
import type { VoiceExpenseResult, MemberContext } from "@/lib/voice-expense-parser";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

const mockVoiceInput = {
  isListening: false,
  transcript: "",
  interimTranscript: "",
  error: null as string | null,
  startListening: vi.fn(),
  stopListening: vi.fn(),
  isSupported: true,
  engine: "web-speech" as const,
  phase: "idle" as const,
  level: 0,
};

vi.mock("@/hooks/use-voice-input", () => ({
  useVoiceInput: () => mockVoiceInput,
}));

const mockGrant = vi.fn();
vi.mock("@/lib/sync/ai-consent", async (importOriginal) => {
  const actual = await importOriginal<typeof AiConsentSync>();
  return { ...actual, grantAiConsent: (...args: unknown[]) => mockGrant(...args) };
});

function seedAiConsent(granted: boolean): void {
  useAppStore.getState().reset();
  useAppStore.setState({
    bootstrapStatus: "ready",
    lastBootstrappedAccountId: "user-1",
    lastBootstrappedGeneration: 0,
    me: {
      id: "user-1",
      handle: "alice",
      name: "Alice",
      avatarUrl: null,
      isBot: false,
      email: "alice@example.com",
      pixKeyType: null,
      pixKeyHint: null,
      onboarded: true,
      notificationPreferences: {},
      aiConsentVersion: granted ? CURRENT_AI_CONSENT_VERSION : null,
      aiConsentGrantedAt: granted ? "2026-01-01T00:00:00.000Z" : null,
    },
  });
}

function seedUsableAiConsent(): void {
  seedAiConsent(true);
}

function revokeAiConsentFor(newUserId: string): void {
  act(() => {
    useAppStore.setState({
      me: { ...useAppStore.getState().me!, id: newUserId, aiConsentVersion: null, aiConsentGrantedAt: null },
      lastBootstrappedAccountId: newUserId,
      aiConsentRevision: useAppStore.getState().aiConsentRevision + 1,
    });
  });
}

beforeEach(() => {
  seedUsableAiConsent();
  mockGrant.mockReset();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockVoiceInput.isListening = false;
  mockVoiceInput.transcript = "";
  mockVoiceInput.interimTranscript = "";
  mockVoiceInput.error = null;
  mockVoiceInput.isSupported = true;
  mockVoiceInput.phase = "idle";
  mockVoiceInput.level = 0;
});

/** Starts a recording through the mic button so the consent attempt exists. */
function tapMic(): void {
  const mic = screen.getByRole("button", { name: /Gravar (conta|novamente)/ });
  fireEvent.click(mic);
}

describe("VoiceExpenseButton", () => {

  it("renders nothing when voice is not supported", () => {
    mockVoiceInput.isSupported = false;
    const { container } = render(
      <VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} onRecordStart={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });


  it("shows transcript in card while listening", () => {
    mockVoiceInput.isListening = true;
    mockVoiceInput.transcript = "uber com João";
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} onRecordStart={vi.fn()} />);
    expect(screen.getByText(/uber com João/)).toBeInTheDocument();
  });

  it("shows voice error while listening", () => {
    mockVoiceInput.isListening = true;
    mockVoiceInput.error = "Permissão do microfone negada.";
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} onRecordStart={vi.fn()} />);
    expect(
      screen.getByText("Permissão do microfone negada."),
    ).toBeInTheDocument();
  });

  describe("review slot", () => {
    it("renders the parsed review in place of the live preview when the mic is idle", () => {
      render(
        <VoiceExpenseButton
          preview
          onResult={vi.fn()}
          onError={vi.fn()}
          onRecordStart={vi.fn()}
          review={<div data-testid="voice-review" />}
        />,
      );

      expect(screen.getByTestId("voice-review")).toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Prévia da conta" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Conta entendida");
      expect(
        screen.getByRole("button", { name: "Gravar novamente" }),
      ).toBeInTheDocument();
    });

    it("hides the review and shows the live preview while recording", () => {
      mockVoiceInput.isListening = true;
      render(
        <VoiceExpenseButton
          preview
          onResult={vi.fn()}
          onError={vi.fn()}
          onRecordStart={vi.fn()}
          review={<div data-testid="voice-review" />}
        />,
      );

      expect(screen.queryByTestId("voice-review")).not.toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Prévia da conta" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Gravar novamente" }),
      ).not.toBeInTheDocument();
    });

    it("keeps the live preview while parsing and swaps in the review after the parse lands", async () => {
      const parsed: VoiceExpenseResult = {
        title: "Uber",
        amountCents: 2500,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      };
      const { promise: parsePending, resolve: resolveFetch } = Promise.withResolvers<Response>();
      vi.spyOn(globalThis, "fetch").mockReturnValue(parsePending);

      mockVoiceInput.isListening = false;
      const review = <div data-testid="voice-review" />;
      const { rerender } = render(
        <VoiceExpenseButton
          preview
          onResult={vi.fn()}
          onError={vi.fn()}
          onRecordStart={vi.fn()}
          review={review}
        />,
      );
      tapMic();
      mockVoiceInput.isListening = true;
      rerender(
        <VoiceExpenseButton
          preview
          onResult={vi.fn()}
          onError={vi.fn()}
          onRecordStart={vi.fn()}
          review={review}
        />,
      );

      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "uber 25 reais";
      rerender(
        <VoiceExpenseButton
          preview
          onResult={vi.fn()}
          onError={vi.fn()}
          onRecordStart={vi.fn()}
          review={review}
        />,
      );

      expect(screen.queryByTestId("voice-review")).not.toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Prévia da conta" }),
      ).toBeInTheDocument();

      resolveFetch(
        new Response(JSON.stringify(parsed), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("voice-review")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("region", { name: "Prévia da conta" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("record lifecycle", () => {
    const parsed: VoiceExpenseResult = {
      title: "Uber",
      amountCents: 2500,
      expenseType: "single_amount",
      items: [],
      participants: [],
      merchantName: null,
    };

    it("signals onRecordStart instead of onError when the mic is tapped", () => {
      const onRecordStart = vi.fn();
      const onError = vi.fn();
      render(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} onRecordStart={onRecordStart} />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Gravar conta" }));

      expect(onRecordStart).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
      expect(mockVoiceInput.startListening).toHaveBeenCalledOnce();
    });

    it("drops a parse that resolves after the button unmounted", async () => {
      const { promise: parsePending, resolve: resolveFetch } = Promise.withResolvers<Response>();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(parsePending);

      const onResult = vi.fn();
      const onError = vi.fn();
      mockVoiceInput.isListening = false;
      const { rerender, unmount } = render(
        <VoiceExpenseButton onResult={onResult} onError={onError} onRecordStart={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Gravar conta" }));
      mockVoiceInput.isListening = true;
      rerender(<VoiceExpenseButton onResult={onResult} onError={onError} onRecordStart={vi.fn()} />);

      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "uber 25 reais";
      rerender(<VoiceExpenseButton onResult={onResult} onError={onError} onRecordStart={vi.fn()} />);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledOnce();
      });

      unmount();
      await act(async () => {
        resolveFetch(
          new Response(JSON.stringify(parsed), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

      expect(onResult).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });
  });


  describe("parseTranscript (listening → stopped transition)", () => {
    const mockResult: VoiceExpenseResult = {
      title: "Uber",
      amountCents: 2500,
      expenseType: "single_amount",
      items: [],
      participants: [
        { spokenName: "João", matchedHandle: "joao", confidence: "high" },
      ],
      merchantName: null,
    };

    function renderAndTransition(
      props: {
        members?: MemberContext[];
        onResult?: ReturnType<typeof vi.fn<(result: VoiceExpenseResult) => void>>;
        onError?: ReturnType<typeof vi.fn<(message: string) => void>>;
        transcript?: string;
        voiceError?: string | null;
      } = {},
    ) {
      const onResult = props.onResult ?? vi.fn<(result: VoiceExpenseResult) => void>();
      const onError = props.onError ?? vi.fn<(message: string) => void>();
      const members = props.members;

      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "";

      const { rerender } = render(
        <VoiceExpenseButton
          members={members}
          onResult={onResult}
          onError={onError}
        onRecordStart={vi.fn()}
        />,
      );
      tapMic();
      mockVoiceInput.isListening = true;
      rerender(
        <VoiceExpenseButton
          members={members}
          onResult={onResult}
          onError={onError}
        onRecordStart={vi.fn()}
        />,
      );

      // Transition: isListening → false with transcript
      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = props.transcript ?? "uber com João 25 reais";
      if (props.voiceError !== undefined) {
        mockVoiceInput.error = props.voiceError;
      }

      rerender(
        <VoiceExpenseButton
          members={members}
          onResult={onResult}
          onError={onError}
        onRecordStart={vi.fn()}
        />,
      );

      return { onResult, onError };
    }

    it("calls fetch with correct body and members when listening stops with transcript", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const members: MemberContext[] = [
        { handle: "joao", name: "João Silva" },
        { handle: "maria", name: "Maria Santos" },
      ];

      renderAndTransition({
        members,
        transcript: "uber com João 25 reais",
      });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledOnce();
      });

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/voice/parse");
      expect(options).toMatchObject({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const body = JSON.parse(options!.body as string);
      expect(body.text).toBe("uber com João 25 reais");
      expect(body.members).toEqual(members);
    });

    it("calls onResult with parsed result on successful fetch", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const onResult = vi.fn();
      renderAndTransition({ onResult });

      await waitFor(() => {
        expect(onResult).toHaveBeenCalledOnce();
      });

      expect(onResult).toHaveBeenCalledWith(mockResult);
    });

    it("shows parsing spinner while fetch is in progress", async () => {
      let resolveFetch!: (value: Response) => void;
      vi.spyOn(globalThis, "fetch").mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );

      renderAndTransition();

      await waitFor(() => {
        expect(screen.getByRole("button")).toBeDisabled();
      });

      // Resolve to clean up
      resolveFetch(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("shows transcript text during parsing state", async () => {
      let resolveFetch!: (value: Response) => void;
      vi.spyOn(globalThis, "fetch").mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );

      renderAndTransition({ transcript: "pizza 30 reais" });

      await waitFor(() => {
        expect(screen.getByRole("button")).toBeDisabled();
      });

      // The transcript is shown in quotes during parsing
      expect(screen.getByText(/pizza 30 reais/)).toBeInTheDocument();

      resolveFetch(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("calls onError with server error message on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "Texto muito curto" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const onError = vi.fn();
      renderAndTransition({ onError });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledOnce();
      });

      expect(onError).toHaveBeenCalledWith("Texto muito curto");
    });

    it("calls onError with fallback message when error response has no JSON body", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Internal Server Error", {
          status: 500,
        }),
      );

      const onError = vi.fn();
      renderAndTransition({ onError });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledOnce();
      });

      expect(onError).toHaveBeenCalledWith("Erro ao processar comando de voz");
    });

    it("calls onError with fallback message on network failure", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new TypeError("Failed to fetch"),
      );

      const onError = vi.fn();
      renderAndTransition({ onError });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledOnce();
      });

      expect(onError).toHaveBeenCalledWith("Sem conexão. Você pode tentar de novo quando a internet voltar.");
    });

    it("calls onError when transcript is empty and no voiceError on stop", () => {
      const onError = vi.fn();

      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "";

      const { rerender } = render(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} onRecordStart={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Gravar conta" }));
      mockVoiceInput.isListening = true;
      rerender(<VoiceExpenseButton onResult={vi.fn()} onError={onError} onRecordStart={vi.fn()} />);

      // Stop with empty transcript and no error
      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "";
      mockVoiceInput.error = null;

      rerender(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} onRecordStart={vi.fn()} />,
      );

      expect(onError).toHaveBeenCalledWith(
        "Nenhuma fala detectada. Tente novamente.",
      );
    });

    it("does not call onError when transcript is empty but voiceError exists", () => {
      const onError = vi.fn();

      mockVoiceInput.isListening = true;
      mockVoiceInput.transcript = "";

      const { rerender } = render(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} onRecordStart={vi.fn()} />,
      );

      // Stop with empty transcript but a voice error already present
      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "";
      mockVoiceInput.error = "Permissão do microfone negada.";

      rerender(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} onRecordStart={vi.fn()} />,
      );

      expect(onError).not.toHaveBeenCalled();
    });

    it("does not trigger parseTranscript when not transitioning from listening", () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // Render already in non-listening state with transcript
      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "some text";

      render(
        <VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} onRecordStart={vi.fn()} />,
      );

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("trims whitespace-only transcript and treats it as empty", () => {
      const onError = vi.fn();

      mockVoiceInput.isListening = false;

      const { rerender } = render(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} onRecordStart={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Gravar conta" }));
      mockVoiceInput.isListening = true;
      rerender(<VoiceExpenseButton onResult={vi.fn()} onError={onError} onRecordStart={vi.fn()} />);

      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "   ";
      mockVoiceInput.error = null;

      rerender(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} onRecordStart={vi.fn()} />,
      );

      expect(onError).toHaveBeenCalledWith(
        "Nenhuma fala detectada. Tente novamente.",
      );
    });

    it("trims transcript text before sending to API", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      renderAndTransition({ transcript: "  uber com João  " });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledOnce();
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.text).toBe("uber com João");
    });

    it("returns to idle state after successful parse", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const onResult = vi.fn();
      renderAndTransition({ onResult });

      // Wait for parsing to complete
      await waitFor(() => {
        expect(onResult).toHaveBeenCalled();
      });

      // After parse completes, should show idle state again
      expect(screen.getByRole("button")).toBeEnabled();
    });

    it("returns to idle state after failed parse", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

      const onError = vi.fn();
      renderAndTransition({ onError });

      await waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });

      expect(screen.getByRole("button")).toBeEnabled();
    });

    it("keeps a recognition failure visible without parsing the partial transcript", () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      renderAndTransition({ transcript: "Uber", voiceError: "Microfone desconectado." });
      expect(screen.getByRole("alert")).toHaveTextContent("Microfone desconectado.");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(screen.getByRole("button")).toBeEnabled();
    });

    it("sends undefined members when no members prop provided", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      renderAndTransition({ members: undefined });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledOnce();
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.text).toBe("uber com João 25 reais");
      expect(body.members).toBeUndefined();
    });
  });

  describe("AI consent gate", () => {
    function grantInStore(): void {
      act(() => {
        useAppStore.setState({
          me: { ...useAppStore.getState().me!, aiConsentVersion: CURRENT_AI_CONSENT_VERSION, aiConsentGrantedAt: "2026-01-01T00:00:00.000Z" },
          aiConsentRevision: useAppStore.getState().aiConsentRevision + 1,
        });
      });
    }

    it("the microphone asks before start", async () => {
      const user = userEvent.setup();
      seedAiConsent(false);
      const onRecordStart = vi.fn();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{}", { status: 200 }),
      );
      render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} onRecordStart={onRecordStart} />);

      await user.click(screen.getByRole("button", { name: "Gravar conta" }));

      expect(screen.getByText("Usar IA no Dividimos?")).toBeInTheDocument();
      expect(mockVoiceInput.startListening).not.toHaveBeenCalled();
      expect(onRecordStart).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("saving consent does not start recording", async () => {
      const user = userEvent.setup();
      seedAiConsent(false);
      const onRecordStart = vi.fn();
      mockGrant.mockImplementation(async () => {
        grantInStore();
      });
      render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} onRecordStart={onRecordStart} />);

      await user.click(screen.getByRole("button", { name: "Gravar conta" }));
      await user.click(screen.getByRole("button", { name: "Permitir uso de IA" }));

      expect(
        await screen.findByText("Permissão salva. Toque de novo no recurso para continuar."),
      ).toBeInTheDocument();
      expect(mockVoiceInput.startListening).not.toHaveBeenCalled();
      expect(onRecordStart).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Voltar" }));
      expect(screen.queryByText("Usar IA no Dividimos?")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Gravar conta" }));

      expect(mockVoiceInput.startListening).toHaveBeenCalledOnce();
      expect(onRecordStart).toHaveBeenCalledOnce();
    });

    it("denial never parses an old transcript", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{}", { status: 200 }),
      );
      const onResult = vi.fn();
      const onError = vi.fn();
      mockVoiceInput.isListening = true;
      const { rerender } = render(
        <VoiceExpenseButton onResult={onResult} onError={onError} onRecordStart={vi.fn()} />,
      );

      revokeAiConsentFor("user-1");
      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "uber 25 reais";
      rerender(<VoiceExpenseButton onResult={onResult} onError={onError} onRecordStart={vi.fn()} />);
      await waitFor(() => {
        expect(mockVoiceInput.isListening).toBe(false);
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(onResult).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it("revocation during parsing never delivers a draft", async () => {
      const { promise: parsePending, resolve: resolveFetch } = Promise.withResolvers<Response>();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(parsePending);
      const onResult = vi.fn();
      const onError = vi.fn();
      mockVoiceInput.isListening = false;
      const { rerender } = render(
        <VoiceExpenseButton onResult={onResult} onError={onError} onRecordStart={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Gravar conta" }));
      mockVoiceInput.isListening = true;
      rerender(<VoiceExpenseButton onResult={onResult} onError={onError} onRecordStart={vi.fn()} />);

      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "uber 25 reais";
      rerender(<VoiceExpenseButton onResult={onResult} onError={onError} onRecordStart={vi.fn()} />);
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledOnce();
      });

      revokeAiConsentFor("user-2");
      await act(async () => {
        resolveFetch(
          new Response(
            JSON.stringify({
              title: "Uber",
              amountCents: 2500,
              expenseType: "single_amount",
              items: [],
              participants: [],
              merchantName: null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      });

      expect(onResult).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });
  });
});
