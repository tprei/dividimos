import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "u1",
      name: "Ana Costa",
      handle: "anacosta",
      email: "ana@test.com",
      avatarUrl: null,
      pixKeyType: "email",
      pixKeyHint: "a**@test.com",
    },
    loading: false,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signOut: vi.fn().mockResolvedValue({}) },
  }),
}));

vi.mock("@/components/profile/profile-share-modal", () => ({
  ProfileShareModal: ({
    open,
    onClose,
    handle,
  }: {
    open: boolean;
    onClose: () => void;
    handle: string;
  }) =>
    open ? (
      <div data-testid="share-modal">
        <span>@{handle}</span>
        <button onClick={onClose}>close</button>
      </div>
    ) : null,
}));

vi.mock("react-hot-toast", () => ({ default: { success: vi.fn() } }));

const updatePixKeyMock = vi.fn<(formData: FormData) => Promise<{ success: true; hint: string }>>(
  async () => ({ success: true, hint: "" }),
);
vi.mock("./actions", () => ({
  updatePixKey: (formData: FormData) => updatePixKeyMock(formData),
}));

const reloadMock = vi.fn();
Object.defineProperty(window, "location", {
  configurable: true,
  value: { ...window.location, reload: reloadMock, href: "" },
});

import ProfilePage from "./page";

describe("ProfilePage QR share button", () => {
  it("renders the share button with QR icon", () => {
    render(<ProfilePage />);
    const btn = screen.getByLabelText("Compartilhar perfil");
    expect(btn).toBeInTheDocument();
  });

  it("opens ProfileShareModal when QR button is clicked", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    expect(screen.queryByTestId("share-modal")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Compartilhar perfil"));

    const modal = screen.getByTestId("share-modal");
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveTextContent("@anacosta");
  });

  it("closes the modal when onClose is called", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByLabelText("Compartilhar perfil"));
    expect(screen.getByTestId("share-modal")).toBeInTheDocument();

    await user.click(screen.getByText("close"));
    expect(screen.queryByTestId("share-modal")).not.toBeInTheDocument();
  });
});

describe("ProfilePage phone Pix key editing", () => {
  it("offers phone as a Pix key option", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByText("E-mail"));

    expect(
      screen.getByRole("button", { name: "Telefone" }),
    ).toBeInTheDocument();
  });

  it("formats digits as a Brazilian phone mask when phone is selected", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByText("E-mail"));
    await user.click(screen.getByRole("button", { name: "Telefone" }));

    await user.type(screen.getByPlaceholderText("(11) 99999-9999"), "11999998888");

    expect(await screen.findByDisplayValue("(11) 99999-8888")).toBeInTheDocument();
  });

  it("submits the phone Pix key with a +55 prefix and stripped formatting", async () => {
    updatePixKeyMock.mockClear();
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByText("E-mail"));
    await user.click(screen.getByRole("button", { name: "Telefone" }));

    const input = screen.getByPlaceholderText("(11) 99999-9999");
    await user.type(input, "11999998888");

    await user.click(screen.getByRole("button", { name: /salvar/i }));

    expect(updatePixKeyMock).toHaveBeenCalledTimes(1);
    const formData = updatePixKeyMock.mock.calls[0][0];
    expect(formData.get("pixKeyType")).toBe("phone");
    expect(formData.get("pixKey")).toBe("+5511999998888");
  });
});
