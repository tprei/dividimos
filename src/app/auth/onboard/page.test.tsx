import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OnboardForm from "./onboard-form";
import type { Me } from "@/types/ledger";
import { lookupUserByHandle } from "@/lib/sync/mutations-group";

vi.mock("@/lib/sync/mutations-group", () => ({ lookupUserByHandle: vi.fn() }));
const lookup = vi.mocked(lookupUserByHandle);
beforeEach(() => { lookup.mockReset().mockResolvedValue(null); });
afterEach(() => { vi.useRealTimers(); });

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

describe("handle availability", () => {
  it("debounces checks, cancels replaced requests and ignores stale availability", async () => {
    vi.useFakeTimers();
    const first = Promise.withResolvers<null>();
    lookup.mockReturnValueOnce(first.promise);
    lookup.mockResolvedValueOnce({ ...me, id: "other", handle: "ocupado" });
    render(<OnboardForm me={me} action={action} />);
    const field = screen.getByLabelText("Handle");
    fireEvent.change(field, { target: { value: "novo_nome" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(lookup).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    const signal = lookup.mock.calls[0][1];
    fireEvent.change(field, { target: { value: "ocupado" } });
    expect(signal?.aborted).toBe(true);
    await act(async () => { first.resolve(null); });
    expect(screen.getByRole("status")).toHaveTextContent("Verificando");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByRole("status")).toHaveTextContent("Já está em uso");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "outro_nome" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("does not call a failed lookup available or leave pending work on unmount", async () => {
    vi.useFakeTimers();
    lookup.mockRejectedValueOnce(new Error("offline"));
    const { unmount } = render(<OnboardForm me={me} action={action} />);
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "novo_nome" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByRole("status")).toHaveTextContent("Não conseguimos verificar agora.");
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "outra_pessoa" } });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe("OnboardForm Pix skip", () => {
  it("renders Nome and Handle together on the profile step", () => {
    render(<OnboardForm me={me} action={action} />);
    expect(screen.getByLabelText("Nome")).toHaveValue("Ana Costa");
    expect(screen.getByLabelText("Handle")).toHaveValue("ana_costa");
  });

  it("renders contract copy and Pular por agora on the Pix step", async () => {
    const user = userEvent.setup();
    render(<OnboardForm me={me} action={action} />);

    await advanceToPixStep(user);

    expect(
      screen.getByText("Pode cadastrar agora ou depois, no seu perfil."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pular por agora" })).toBeInTheDocument();
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
