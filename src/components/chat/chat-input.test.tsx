import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "./chat-input";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

// Stub the tooltip portal to avoid happy-dom issues
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

const mockResult: ChatExpenseResult = {
  title: "Pizza",
  amountCents: 6000,
  expenseType: "single_amount",
  splitType: "equal",
  items: [],
  participants: [],
  payerHandle: "SELF",
  merchantName: null,
  confidence: "high",
};

describe("ChatInput", () => {
  const defaultProps = {
    members: [{ handle: "joao", name: "João" }],
    onSendText: vi.fn().mockResolvedValue(undefined),
    onAiResult: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders text input and buttons", () => {
    render(<ChatInput {...defaultProps} />);

    expect(
      screen.getByPlaceholderText("Mensagem..."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enviar mensagem" }),
    ).toBeInTheDocument();
  });

  it("renders sparkle toggle button", () => {
    render(<ChatInput {...defaultProps} />);

    const sparkleBtn = screen.getByRole("button", {
      name: "Ativar modo IA para criar despesa",
    });
    expect(sparkleBtn).toBeInTheDocument();
    expect(sparkleBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles AI mode when sparkle button is clicked", async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    const sparkleBtn = screen.getByRole("button", {
      name: "Ativar modo IA para criar despesa",
    });

    await user.click(sparkleBtn);

    expect(sparkleBtn).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByPlaceholderText(/pizza 60 reais/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Processar com IA" }),
    ).toBeInTheDocument();
  });

  it("shows AI hint popup when toggling to AI mode", async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    const sparkleBtn = screen.getByRole("button", {
      name: "Ativar modo IA para criar despesa",
    });

    await user.click(sparkleBtn);

    expect(screen.getByText(/a IA cria um rascunho/i)).toBeInTheDocument();
  });

  it("toggles back to text mode on second click", async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    const sparkleBtn = screen.getByRole("button", {
      name: "Ativar modo IA para criar despesa",
    });

    await user.click(sparkleBtn);
    expect(sparkleBtn).toHaveAttribute("aria-pressed", "true");

    await user.click(sparkleBtn);
    expect(sparkleBtn).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByPlaceholderText("Mensagem..."),
    ).toBeInTheDocument();
  });

  it("sends text message on form submit in text mode", async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("Mensagem...");
    await user.type(input, "Olá!");

    const sendBtn = screen.getByRole("button", { name: "Enviar mensagem" });
    await user.click(sendBtn);

    expect(defaultProps.onSendText).toHaveBeenCalledWith("Olá!");
  });

  it("clears input after successful text send", async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("Mensagem...");
    await user.type(input, "Hello");
    await user.click(
      screen.getByRole("button", { name: "Enviar mensagem" }),
    );

    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });

  it("disables send button when input is empty", () => {
    render(<ChatInput {...defaultProps} />);

    const sendBtn = screen.getByRole("button", { name: "Enviar mensagem" });
    expect(sendBtn).toBeDisabled();
  });

  it("disables input when disabled prop is true", () => {
    render(<ChatInput {...defaultProps} disabled />);

    const input = screen.getByPlaceholderText("Mensagem...");
    expect(input).toBeDisabled();
  });

  it("calls /api/chat/parse and onAiResult in AI mode", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });
    vi.stubGlobal("fetch", mockFetch);

    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    await user.click(
      screen.getByRole("button", {
        name: "Ativar modo IA para criar despesa",
      }),
    );

    const input = screen.getByPlaceholderText(/pizza 60 reais/i);
    fireEvent.change(input, {
      target: { value: "pizza 60 reais rachei com João" },
    });

    await user.click(
      screen.getByRole("button", { name: "Processar com IA" }),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chat/parse",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            text: "pizza 60 reais rachei com João",
            members: [{ handle: "joao", name: "João" }],
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(defaultProps.onAiResult).toHaveBeenCalledWith(
        mockResult,
        "pizza 60 reais rachei com João",
      );
    });
  });

  it("does not call onSendText in AI mode", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });
    vi.stubGlobal("fetch", mockFetch);

    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    await user.click(
      screen.getByRole("button", {
        name: "Ativar modo IA para criar despesa",
      }),
    );

    const input = screen.getByPlaceholderText(/pizza 60 reais/i);
    fireEvent.change(input, { target: { value: "pizza 60 reais" } });

    await user.click(
      screen.getByRole("button", { name: "Processar com IA" }),
    );

    await waitFor(() => {
      expect(defaultProps.onAiResult).toHaveBeenCalled();
    });

    expect(defaultProps.onSendText).not.toHaveBeenCalled();
  });

  it("handles API error gracefully in AI mode", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Erro ao processar" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    await user.click(
      screen.getByRole("button", {
        name: "Ativar modo IA para criar despesa",
      }),
    );

    const input = screen.getByPlaceholderText(/pizza 60 reais/i);
    await user.type(input, "pizza");

    await user.click(
      screen.getByRole("button", { name: "Processar com IA" }),
    );

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "[ChatInput] AI parse error:",
        expect.any(Error),
      );
    });

    expect(defaultProps.onAiResult).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("resets to text mode after successful AI parse", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });
    vi.stubGlobal("fetch", mockFetch);

    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    await user.click(
      screen.getByRole("button", {
        name: "Ativar modo IA para criar despesa",
      }),
    );

    const input = screen.getByPlaceholderText(/pizza 60 reais/i);
    await user.type(input, "pizza 60");

    await user.click(
      screen.getByRole("button", { name: "Processar com IA" }),
    );

    await waitFor(() => {
      expect(defaultProps.onAiResult).toHaveBeenCalled();
    });

    expect(
      screen.getByPlaceholderText("Mensagem..."),
    ).toBeInTheDocument();
  });

  it("sends message on Enter key (not Shift+Enter)", async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("Mensagem...");
    await user.type(input, "test message");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSendText).toHaveBeenCalledWith("test message");
  });

  it("does not send on Shift+Enter (allows newline)", async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("Mensagem...");
    await user.type(input, "line 1");
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(defaultProps.onSendText).not.toHaveBeenCalled();
  });
});
