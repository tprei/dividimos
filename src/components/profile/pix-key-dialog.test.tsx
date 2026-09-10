import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Me } from "@/types/ledger";

const { updatePixKeyMock } = vi.hoisted(() => ({
  updatePixKeyMock: vi.fn(),
}));
vi.mock("@/app/app/profile/actions", () => ({
  updatePixKey: (expectedUserId: string, formData: FormData) =>
    updatePixKeyMock(expectedUserId, formData),
}));

import { PixKeyDialog } from "./pix-key-dialog";

const me: Me = {
  id: "u1",
  name: "Ana Costa",
  handle: "anacosta",
  email: "ana@test.com",
  avatarUrl: null,
  pixKeyType: "email",
  pixKeyHint: "a**@test.com",
  onboarded: true,
  notificationPreferences: {},
};

function setup(meOverrides: Partial<Me> = {}) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <PixKeyDialog
      open
      onOpenChange={onOpenChange}
      me={{ ...me, ...meOverrides }}
      onSaved={onSaved}
    />,
  );
  return { onOpenChange, onSaved };
}

beforeEach(() => {
  vi.resetAllMocks();
  updatePixKeyMock.mockResolvedValue({
    pixKeyType: "email",
    pixKeyHint: "a**@test.com",
  });
});

describe("PixKeyDialog", () => {
  it("seeds the type from me and starts with an empty key", () => {
    setup({ pixKeyType: "cpf" });

    expect(screen.getByRole("combobox", { name: "Tipo" })).toHaveTextContent(
      "CPF",
    );
    expect(screen.getByLabelText("Chave")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("clears the typed value when the type changes", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText("Chave"), "ana@test.com");
    await user.click(screen.getByRole("combobox", { name: "Tipo" }));
    await user.click(screen.getByRole("option", { name: "Telefone" }));

    expect(screen.getByLabelText("Chave")).toHaveValue("");
  });

  it("formats phone input and submits the +55 prefixed key", async () => {
    const user = userEvent.setup();
    const { onSaved, onOpenChange } = setup();
    updatePixKeyMock.mockResolvedValueOnce({
      pixKeyType: "phone",
      pixKeyHint: "(11) 99999-8888",
    });

    await user.click(screen.getByRole("combobox", { name: "Tipo" }));
    await user.click(screen.getByRole("option", { name: "Telefone" }));
    await user.type(screen.getByPlaceholderText("(11) 99999-9999"), "11999998888");
    expect(screen.getByLabelText("Chave")).toHaveValue("(11) 99999-8888");

    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(updatePixKeyMock).toHaveBeenCalledTimes(1);
    expect(updatePixKeyMock.mock.calls[0][0]).toBe("u1");
    const formData = updatePixKeyMock.mock.calls[0][1] as FormData;
    expect(formData.get("pixKeyType")).toBe("phone");
    expect(formData.get("pixKey")).toBe("+5511999998888");

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
        pixKeyType: "phone",
        pixKeyHint: "(11) 99999-8888",
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("submits a CPF as digits only", async () => {
    const user = userEvent.setup();
    const { onSaved } = setup();
    updatePixKeyMock.mockResolvedValueOnce({
      pixKeyType: "cpf",
      pixKeyHint: "***.***.*89*-01",
    });

    await user.click(screen.getByRole("combobox", { name: "Tipo" }));
    await user.click(screen.getByRole("option", { name: "CPF" }));
    await user.type(screen.getByPlaceholderText("000.000.000-00"), "12345678901");
    expect(screen.getByLabelText("Chave")).toHaveValue("123.456.789-01");

    await user.click(screen.getByRole("button", { name: "Salvar" }));

    const formData = updatePixKeyMock.mock.calls[0][1] as FormData;
    expect(formData.get("pixKey")).toBe("12345678901");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("keeps only uuid characters for a random key", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("combobox", { name: "Tipo" }));
    await user.click(screen.getByRole("option", { name: "Chave aleatória" }));
    await user.type(
      screen.getByPlaceholderText("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"),
      "ABC-123xyz!",
    );

    expect(screen.getByLabelText("Chave")).toHaveValue("abc-123");
  });

  it("keeps the dialog open with the typed value and shows the error when the save fails", async () => {
    const user = userEvent.setup();
    const { onSaved, onOpenChange } = setup();
    updatePixKeyMock.mockResolvedValueOnce({
      error: "Chave Pix invalida para o tipo selecionado",
    });

    await user.type(screen.getByLabelText("Chave"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("Chave Pix invalida para o tipo selecionado");
    expect(screen.getByLabelText("Chave")).toHaveValue("not-an-email");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
