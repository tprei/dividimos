import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OnboardForm from "./onboard-form";
import type { Me } from "@/types/ledger";

const me: Me = {
  id: "user-a",
  handle: "ana_costa",
  name: "Ana Costa",
  avatarUrl: null,
  isBot: false,
  email: "ana@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: false,
  notificationPreferences: {},
};

const action = vi.fn().mockResolvedValue(undefined);

async function advanceToPixStep(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByDisplayValue("ana_costa");
  await user.click(screen.getByRole("button", { name: /Continuar/i }));
  await screen.findByRole("heading", { name: "Chave Pix" });
}

describe("OnboardForm Pix skip", () => {
  it("keeps an edited name when returning from the handle step", async () => {
    const user = userEvent.setup();
    render(<OnboardForm me={me} action={action} />);
    await user.click(screen.getByRole("button", { name: /Alterar nome/ }));
    await user.clear(screen.getByLabelText("Nome"));
    await user.type(screen.getByLabelText("Nome"), "Ana Souza");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.queryByLabelText("Nome")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Alterar nome/ }));
    expect(screen.getByLabelText("Nome")).toHaveValue("Ana Souza");
  });

  beforeEach(() => {
    action.mockClear();
  });


  it("offers the e-mail only as an explicit chip and never pre-fills the key", async () => {
    const user = userEvent.setup();
    render(<OnboardForm me={me} action={action} />);

    await advanceToPixStep(user);

    const input = screen.getByPlaceholderText("ana@example.com");
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: /Começar a usar/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Usar meu e-mail/i }));
    expect(input).toHaveValue("ana@example.com");
    expect(screen.queryByRole("button", { name: /Usar meu e-mail/i })).not.toBeInTheDocument();

    await user.clear(input);
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: /Começar a usar/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Usar meu e-mail/i })).toBeInTheDocument();
  });

  it("submits skip intent without a Pix key", async () => {
    const user = userEvent.setup();
    render(<OnboardForm me={me} action={action} />);

    await advanceToPixStep(user);
    await user.click(screen.getByRole("button", { name: "Pular por agora" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = action.mock.calls[0][0] as FormData;
    expect(formData.get("intent")).toBe("skip");
    expect(formData.get("handle")).toBe("ana_costa");
  });
});

describe("OnboardForm phone Pix key", () => {
  beforeEach(() => {
    action.mockClear();
  });

  it("renders the Telefone Pix key option on the Pix step", async () => {
    const user = userEvent.setup();
    render(<OnboardForm me={me} action={action} />);

    await advanceToPixStep(user);

    expect(screen.getByRole("button", { name: "Telefone" })).toBeInTheDocument();
  });

  it("selecting Telefone switches placeholder and inputMode to numeric", async () => {
    const user = userEvent.setup();
    render(<OnboardForm me={me} action={action} />);

    await advanceToPixStep(user);
    await user.click(screen.getByRole("button", { name: "Telefone" }));

    const input = await screen.findByPlaceholderText("(11) 99999-9999");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("formats a typed phone number and submits without client identity fields", async () => {
    const user = userEvent.setup();
    render(<OnboardForm me={me} action={action} />);

    await advanceToPixStep(user);
    await user.click(screen.getByRole("button", { name: "Telefone" }));

    const input = await screen.findByPlaceholderText("(11) 99999-9999");
    fireEvent.change(input, { target: { value: "11999998888" } });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("(11) 99999-9999")).toHaveValue(
        "(11) 99999-8888",
      );
    });

    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    const formData = action.mock.calls[0][0] as FormData;
    expect(formData.get("pixKeyType")).toBe("phone");
    expect(formData.get("pixKey")).toBe("+5511999998888");
    expect(formData.get("userId")).toBeNull();
    expect(formData.get("next")).toBeNull();
  });
});
