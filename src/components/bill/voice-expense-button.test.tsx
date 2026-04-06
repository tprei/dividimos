import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceExpenseButton } from "./voice-expense-button";

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
  mockVoiceInput.isListening = false;
  mockVoiceInput.transcript = "";
  mockVoiceInput.interimTranscript = "";
  mockVoiceInput.error = null;
  mockVoiceInput.isSupported = true;
});

describe("VoiceExpenseButton", () => {
  it("renders the button when voice is supported", () => {
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText("Falar despesa")).toBeInTheDocument();
  });

  it("renders nothing when voice is not supported", () => {
    mockVoiceInput.isSupported = false;
    const { container } = render(
      <VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("calls startListening when button is clicked", async () => {
    const user = userEvent.setup();
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);

    await user.click(screen.getByText("Falar despesa"));
    expect(mockVoiceInput.startListening).toHaveBeenCalledOnce();
  });

  it("shows stop button when listening", () => {
    mockVoiceInput.isListening = true;
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);

    expect(screen.getByText("Toque pra parar")).toBeInTheDocument();
  });

  it("shows transcript while listening", () => {
    mockVoiceInput.isListening = true;
    mockVoiceInput.transcript = "uber com João";
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);

    expect(screen.getByText(/uber com João/)).toBeInTheDocument();
  });

  it("shows interim transcript while listening", () => {
    mockVoiceInput.isListening = true;
    mockVoiceInput.interimTranscript = "uber";
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);

    expect(screen.getByText("uber")).toBeInTheDocument();
  });

  it("shows voice error while listening", () => {
    mockVoiceInput.isListening = true;
    mockVoiceInput.error = "Permissão do microfone negada.";
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);

    expect(screen.getByText("Permissão do microfone negada.")).toBeInTheDocument();
  });

  it("calls stopListening when stop button is clicked", async () => {
    mockVoiceInput.isListening = true;
    const user = userEvent.setup();
    render(<VoiceExpenseButton onResult={vi.fn()} onError={vi.fn()} />);

    await user.click(screen.getByText("Toque pra parar").previousElementSibling!);
    expect(mockVoiceInput.stopListening).toHaveBeenCalledOnce();
  });
});
