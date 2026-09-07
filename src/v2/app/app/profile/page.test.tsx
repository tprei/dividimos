import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { LedgerError } from "@/lib/sync/errors";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
  }),
}));

const mockSignOut = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/lib/sync/client", () => ({
  getSupabase: () => ({
    auth: { signOut: mockSignOut },
  }),
}));

const { updateProfileMock } = vi.hoisted(() => ({
  updateProfileMock: vi.fn(),
}));
vi.mock("@/lib/sync/mutations-group", () => ({
  updateProfile: updateProfileMock,
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

const { toastSuccessMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({
  default: {
    success: toastSuccessMock,
    error: vi.fn(),
  },
}));

const { updatePixKeyMock } = vi.hoisted(() => ({
  updatePixKeyMock: vi.fn(),
}));
vi.mock("./actions", () => ({
  updatePixKey: (expectedUserId: string, formData: FormData) =>
    updatePixKeyMock(expectedUserId, formData),
}));

import ProfilePage from "./page";

const userA: Me = {
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

const userB: Me = {
  id: "u2",
  name: "Bruno Lima",
  handle: "brunolima",
  email: "bruno@test.com",
  avatarUrl: null,
  pixKeyType: "phone",
  pixKeyHint: "(**) 99999-9999",
  onboarded: true,
  notificationPreferences: {},
};

beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.getState().reset();
  useAppStore.setState({ hydrated: true, me: userA });
  updatePixKeyMock.mockResolvedValue({
    pixKeyType: "email",
    pixKeyHint: "a**@test.com",
  });
  updateProfileMock.mockResolvedValue(userA);
});

describe("ProfilePage QR share button", () => {
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

describe("ProfilePage loading skeleton", () => {
  it("renders the loading skeleton while me is null", () => {
    useAppStore.setState({ hydrated: true, me: null });
    const { container } = render(<ProfilePage />);

    expect(container.querySelector(".h-16.w-16.rounded-full")).not.toBeNull();
    expect(screen.queryByText("Chave Pix")).not.toBeInTheDocument();
    expect(screen.queryByText("Ana Costa")).not.toBeInTheDocument();
  });
});

describe("ProfilePage name and handle editing", () => {
  it("opens edit form and saves updated name and handle", async () => {
    const user = userEvent.setup();
    const updatedUser: Me = { ...userA, name: "Ana Silva", handle: "anasilva" };
    updateProfileMock.mockResolvedValueOnce(updatedUser);

    render(<ProfilePage />);

    await user.click(screen.getByLabelText("Editar perfil"));

    const nameInput = screen.getByPlaceholderText("Seu nome");
    const handleInput = screen.getByPlaceholderText("seu_usuario");

    expect(nameInput).toHaveValue("Ana Costa");
    expect(handleInput).toHaveValue("anacosta");

    fireEvent.change(nameInput, { target: { value: "Ana Silva" } });
    fireEvent.change(screen.getByPlaceholderText("seu_usuario"), {
      target: { value: "anasilva" },
    });
    await user.click(screen.getByRole("button", { name: /salvar/i }));
    expect(updateProfileMock).toHaveBeenCalledWith({
      name: "Ana Silva",
      handle: "anasilva",
    });

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("Perfil atualizado");
    });
  });

  it("displays inline error when handle is taken", async () => {
    const user = userEvent.setup();
    updateProfileMock.mockRejectedValueOnce(new LedgerError("handle_taken"));

    render(<ProfilePage />);

    await user.click(screen.getByLabelText("Editar perfil"));

    const handleInput = screen.getByPlaceholderText("seu_usuario");
    fireEvent.change(handleInput, { target: { value: "alreadytaken" } });

    await user.click(screen.getByRole("button", { name: /salvar/i }));

    expect(
      await screen.findByText("Esse @ já está em uso. Tente outro."),
    ).toBeInTheDocument();
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

  it("submits the phone Pix key with a +55 prefix and patches store with returned key info", async () => {
    const user = userEvent.setup();
    updatePixKeyMock.mockResolvedValueOnce({
      pixKeyType: "phone",
      pixKeyHint: "(11) 99999-8888",
    });

    render(<ProfilePage />);

    await user.click(screen.getByText("E-mail"));
    await user.click(screen.getByRole("button", { name: "Telefone" }));

    const input = screen.getByPlaceholderText("(11) 99999-9999");
    await user.type(input, "11999998888");

    await user.click(screen.getByRole("button", { name: /salvar/i }));

    expect(updatePixKeyMock).toHaveBeenCalledTimes(1);
    expect(updatePixKeyMock.mock.calls[0][0]).toBe("u1");
    const formData = updatePixKeyMock.mock.calls[0][1];
    expect(formData.get("pixKeyType")).toBe("phone");
    expect(formData.get("pixKey")).toBe("+5511999998888");

    await waitFor(() => {
      expect(useAppStore.getState().me?.pixKeyType).toBe("phone");
      expect(useAppStore.getState().me?.pixKeyHint).toBe("(11) 99999-8888");
      expect(toastSuccessMock).toHaveBeenCalledWith("Chave Pix salva");
    });
  });
});

describe("ProfilePage identity-keyed state", () => {
  it("discards an in-progress Pix draft when the identity changes", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ hydrated: true, me: userA });
    const { rerender } = render(<ProfilePage />);

    await user.click(screen.getByText("E-mail"));
    await user.click(screen.getByRole("button", { name: "Telefone" }));
    await user.type(
      screen.getByPlaceholderText("(11) 99999-9999"),
      "11999998888",
    );
    expect(screen.getByDisplayValue("(11) 99999-8888")).toBeInTheDocument();

    useAppStore.setState({ hydrated: true, me: userB });
    rerender(<ProfilePage />);

    expect(screen.queryByDisplayValue("(11) 99999-8888")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("(11) 99999-9999"),
    ).not.toBeInTheDocument();
  });

  it("ignores a save result that resolves after the identity changed", async () => {
    const saveDeferred = deferred<{ pixKeyType: string; pixKeyHint: string }>();
    updatePixKeyMock.mockImplementation(() => saveDeferred.promise);

    const user = userEvent.setup();
    useAppStore.setState({ hydrated: true, me: userA });
    const { rerender } = render(<ProfilePage />);

    await user.click(screen.getByText("E-mail"));
    await user.click(screen.getByRole("button", { name: "Telefone" }));
    await user.type(
      screen.getByPlaceholderText("(11) 99999-9999"),
      "11999998888",
    );
    await user.click(screen.getByRole("button", { name: /salvar/i }));

    expect(updatePixKeyMock).toHaveBeenCalledTimes(1);

    useAppStore.setState({ hydrated: true, me: userB });
    rerender(<ProfilePage />);

    saveDeferred.resolve({ pixKeyType: "phone", pixKeyHint: "(11) 99999-8888" });
    const { promise: flushed, resolve: flush } = deferred<void>();
    setTimeout(flush, 0);
    await flushed;

    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("signs out and redirects to /auth", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole("button", { name: /sair/i }));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockRouterReplace).toHaveBeenCalledWith("/auth");
    });
  });
});
