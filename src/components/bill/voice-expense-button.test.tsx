import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceExpenseButton } from "./voice-expense-button";

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
});
