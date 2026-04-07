import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceExpenseButton } from "./voice-expense-button";
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
};

vi.mock("@/hooks/use-voice-input", () => ({
  useVoiceInput: () => mockVoiceInput,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockVoiceInput.isListening = false;
  mockVoiceInput.transcript = "";
  mockVoiceInput.interimTranscript = "";
  mockVoiceInput.error = null;
  mockVoiceInput.isSupported = true;
});

describe("VoiceExpenseButton", () => {
  it("renders idle state when voice is supported", () => {
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText("Toque pra falar")).toBeInTheDocument();
  });

  it("renders nothing when voice is not supported", () => {
    mockVoiceInput.isSupported = false;
    const { container } = render(
      <VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("calls startListening when mic button is clicked", async () => {
    const user = userEvent.setup();
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);
    const container = screen.getByText("Toque pra falar").closest("[class*='flex-col']")!;
    const micButton = container.querySelector("button")!;
    await user.click(micButton);
    expect(mockVoiceInput.startListening).toHaveBeenCalledOnce();
  });

  it("shows stop UI when listening", () => {
    mockVoiceInput.isListening = true;
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText("Toque pra parar")).toBeInTheDocument();
  });

  it("shows transcript in card while listening", () => {
    mockVoiceInput.isListening = true;
    mockVoiceInput.transcript = "uber com João";
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText(/uber com João/)).toBeInTheDocument();
  });

  it("shows voice error while listening", () => {
    mockVoiceInput.isListening = true;
    mockVoiceInput.error = "Permissão do microfone negada.";
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);
    expect(
      screen.getByText("Permissão do microfone negada."),
    ).toBeInTheDocument();
  });

  it("calls stopListening when stop button is clicked", async () => {
    mockVoiceInput.isListening = true;
    const user = userEvent.setup();
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);
    const stopButton = screen.getByText("Toque pra parar")
      .closest("div")!
      .querySelector("button")!;
    await user.click(stopButton);
    expect(mockVoiceInput.stopListening).toHaveBeenCalledOnce();
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

      // Start with isListening = true
      mockVoiceInput.isListening = true;
      mockVoiceInput.transcript = "";

      const { rerender } = render(
        <VoiceExpenseButton
          members={members}
          onResult={onResult}
          onError={onError}
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
        expect(screen.getByText("Processando...")).toBeInTheDocument();
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
        expect(screen.getByText("Processando...")).toBeInTheDocument();
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

      expect(onError).toHaveBeenCalledWith("Failed to fetch");
    });

    it("calls onError when transcript is empty and no voiceError on stop", () => {
      const onError = vi.fn();

      mockVoiceInput.isListening = true;
      mockVoiceInput.transcript = "";

      const { rerender } = render(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} />,
      );

      // Stop with empty transcript and no error
      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "";
      mockVoiceInput.error = null;

      rerender(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} />,
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
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} />,
      );

      // Stop with empty transcript but a voice error already present
      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "";
      mockVoiceInput.error = "Permissão do microfone negada.";

      rerender(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} />,
      );

      expect(onError).not.toHaveBeenCalled();
    });

    it("does not trigger parseTranscript when not transitioning from listening", () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      // Render already in non-listening state with transcript
      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "some text";

      render(
        <VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />,
      );

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("trims whitespace-only transcript and treats it as empty", () => {
      const onError = vi.fn();

      mockVoiceInput.isListening = true;

      const { rerender } = render(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} />,
      );

      mockVoiceInput.isListening = false;
      mockVoiceInput.transcript = "   ";
      mockVoiceInput.error = null;

      rerender(
        <VoiceExpenseButton onResult={vi.fn()} onError={onError} />,
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
      expect(screen.queryByText("Processando...")).not.toBeInTheDocument();
    });

    it("returns to idle state after failed parse", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

      const onError = vi.fn();
      renderAndTransition({ onError });

      await waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });

      expect(screen.queryByText("Processando...")).not.toBeInTheDocument();
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
});
