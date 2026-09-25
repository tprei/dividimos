import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ChatInput } from "./chat-input";

describe("ChatInput", () => {
  it("renders textarea and send button", () => {
    render(<ChatInput onSend={vi.fn()} />);

    expect(
      screen.getByPlaceholderText("Mensagem..."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enviar mensagem" }),
    ).toBeInTheDocument();
  });

  it("send button is disabled when input is empty", () => {
    render(<ChatInput onSend={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Enviar mensagem" });
    expect(button).toBeDisabled();
  });

  it("send button is enabled when input has text", async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={vi.fn()} />);

    const textarea = screen.getByPlaceholderText("Mensagem...");
    await user.type(textarea, "Olá");

    const button = screen.getByRole("button", { name: "Enviar mensagem" });
    expect(button).not.toBeDisabled();
  });

  it("calls onSend with trimmed content on button click", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Mensagem...");
    await user.type(textarea, "  Olá mundo  ");

    const button = screen.getByRole("button", { name: "Enviar mensagem" });
    await user.click(button);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("Olá mundo");
    });
  });

  it("clears input after successful send", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Mensagem...");
    await user.type(textarea, "Olá");
    await user.click(
      screen.getByRole("button", { name: "Enviar mensagem" }),
    );

    await waitFor(() => {
      expect(textarea).toHaveValue("");
    });
  });
  it("keeps input and reports a failed send", async () => {
    const error = new Error("offline");
    const onSend = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput onSend={onSend} onError={onError} />);

    const textarea = screen.getByPlaceholderText("Mensagem...");
    await user.type(textarea, "Olá");
    await user.click(screen.getByRole("button", { name: "Enviar mensagem" }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(error);
      expect(textarea).toHaveValue("Olá");
    });
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).not.toBeDisabled();
  });

  it("sends on Enter key (without Shift)", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Mensagem...");
    await user.type(textarea, "Olá");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("Olá");
    });
  });

  it("does not send on Shift+Enter (allows newline)", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Mensagem...");
    await user.type(textarea, "Olá");
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send whitespace-only messages", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Mensagem...");
    await user.type(textarea, "   ");

    const button = screen.getByRole("button", { name: "Enviar mensagem" });
    expect(button).toBeDisabled();
  });

  it("disables input when disabled prop is true", () => {
    render(<ChatInput onSend={vi.fn()} disabled />);

    const textarea = screen.getByPlaceholderText("Mensagem...");
    expect(textarea).toBeDisabled();
  });

  it("sends the characters an IME still holds in marked text", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>("Mensagem...");
    await user.type(textarea, "Ol");
    fireEvent.compositionStart(textarea);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Ola");
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("Ola");
    });
  });

  it("an Enter that confirms an IME candidate does not send", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Mensagem...");
    await user.type(textarea, "ni hao");
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });

    expect(onSend).not.toHaveBeenCalled();
  });
});
