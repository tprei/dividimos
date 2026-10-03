import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoomCodeEntry } from "./room-code-entry";

const props = { onSubmit: vi.fn(), pending: false, errorMessage: null };

describe("RoomCodeEntry", () => {
  it("submits the typed code without changing accents, case, or spacing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<RoomCodeEntry {...props} onSubmit={onSubmit} />);

    await user.type(screen.getByRole("textbox", { name: "Código da sala" }), " Cafuné Legal ");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(" Cafuné Legal ");
  });

  it("does not submit empty or whitespace-only values", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<RoomCodeEntry {...props} onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: "Código da sala" });

    expect(screen.getByRole("button", { name: "Entrar" })).toBeDisabled();
    await user.type(input, "   ");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeDisabled();
    const form = input.closest("form");
    if (!form) throw new Error("Missing code entry form");
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("prevents duplicate submissions while pending and preserves the input", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(<RoomCodeEntry {...props} onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: "Código da sala" });
    await user.type(input, "pipoca-moleza");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();

    rerender(<RoomCodeEntry {...props} onSubmit={onSubmit} pending />);
    expect(screen.getByRole("button", { name: "Abrindo..." })).toBeDisabled();
    expect(input).toBeDisabled();
    expect(input).toHaveValue("pipoca-moleza");
    const form = input.closest("form");
    if (!form) throw new Error("Missing code entry form");
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(<RoomCodeEntry {...props} onSubmit={onSubmit} />);
    expect(input).toHaveValue("pipoca-moleza");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });

  it("shows the error as an alert associated with the input", () => {
    const errorMessage = "Esse código não existe ou já expirou. Confere com quem criou a sala.";
    render(<RoomCodeEntry {...props} errorMessage={errorMessage} />);

    expect(screen.getByRole("alert")).toHaveTextContent(errorMessage);
    expect(screen.getByRole("textbox", { name: "Código da sala" })).toHaveAccessibleDescription(
      `Digite o código que apareceu pra quem criou a sala. ${errorMessage}`,
    );
  });
});
