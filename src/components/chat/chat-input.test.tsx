import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatInput } from "./chat-input";

const mockSendChatMessage = vi.fn();

vi.mock("@/lib/supabase/chat-actions", () => ({
  sendChatMessage: (...args: unknown[]) => mockSendChatMessage(...args),
}));

describe("ChatInput", () => {
  beforeEach(() => {
    mockSendChatMessage.mockReset();
    mockSendChatMessage.mockResolvedValue({ id: "msg-new" });
  });

  it("renders input and send button", () => {
    render(<ChatInput groupId="group-1" />);

    expect(screen.getByPlaceholderText("Enviar mensagem...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });

  it("send button is disabled when input is empty", () => {
    render(<ChatInput groupId="group-1" />);

    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  it("send button is disabled when input contains only whitespace", () => {
    render(<ChatInput groupId="group-1" />);

    fireEvent.change(screen.getByPlaceholderText("Enviar mensagem..."), {
      target: { value: "   " },
    });

    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  it("send button is enabled when input has text", () => {
    render(<ChatInput groupId="group-1" />);

    fireEvent.change(screen.getByPlaceholderText("Enviar mensagem..."), {
      target: { value: "Olá!" },
    });

    expect(screen.getByRole("button", { name: "Enviar" })).not.toBeDisabled();
  });

  it("calls sendChatMessage with groupId and trimmed content on submit", async () => {
    render(<ChatInput groupId="group-1" />);

    fireEvent.change(screen.getByPlaceholderText("Enviar mensagem..."), {
      target: { value: "  Olá!  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => {
      expect(mockSendChatMessage).toHaveBeenCalledWith("group-1", "Olá!");
    });
  });

  it("clears input after successful send", async () => {
    render(<ChatInput groupId="group-1" />);

    const input = screen.getByPlaceholderText("Enviar mensagem...");
    fireEvent.change(input, { target: { value: "Mensagem" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });

  it("sparkle button toggles visual state", () => {
    render(<ChatInput groupId="group-1" />);

    const sparkleBtn = screen.getByRole("button", { name: "Sugestão de IA" });

    expect(sparkleBtn).not.toHaveClass("bg-primary/10");
    fireEvent.click(sparkleBtn);
    expect(sparkleBtn).toHaveClass("bg-primary/10");
    fireEvent.click(sparkleBtn);
    expect(sparkleBtn).not.toHaveClass("bg-primary/10");
  });
});
