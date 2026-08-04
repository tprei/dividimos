import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PixKeyType } from "@/types";

// `Promise.withResolvers` is not available on the Node version CI runs unit
// tests with, so the deferred is built explicitly.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
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

const { toastSuccessMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({
  default: { success: toastSuccessMock },
}));

const { updatePixKeyMock } = vi.hoisted(() => ({
  updatePixKeyMock: vi.fn<
    (
      expectedUserId: string,
      formData: FormData,
    ) => Promise<{ error: string } | { success: true; hint: string }>
  >(async () => ({ success: true, hint: "" })),
}));
vi.mock("./actions", () => ({
  updatePixKey: (expectedUserId: string, formData: FormData) =>
    updatePixKeyMock(expectedUserId, formData),
}));

const reloadMock = vi.fn();
Object.defineProperty(window, "location", {
  configurable: true,
  value: { ...window.location, reload: reloadMock, href: "" },
});

import ProfilePage from "./page";

type AuthedUser = {
  id: string;
  name: string;
  handle: string;
  email: string;
  avatarUrl: string | null;
  pixKeyType: PixKeyType;
  pixKeyHint: string;
};

const userA: AuthedUser = {
  id: "u1",
  name: "Ana Costa",
  handle: "anacosta",
  email: "ana@test.com",
  avatarUrl: null,
  pixKeyType: "email",
  pixKeyHint: "a**@test.com",
};

const userB: AuthedUser = {
  id: "u2",
  name: "Bruno Lima",
  handle: "brunolima",
  email: "bruno@test.com",
  avatarUrl: null,
  pixKeyType: "phone",
  pixKeyHint: "(**) 99999-9999",
};

function authenticatedAs(user: AuthedUser, generation: number) {
  return { status: "authenticated" as const, userId: user.id, generation, user };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue(authenticatedAs(userA, 0));
  updatePixKeyMock.mockImplementation(async () => ({ success: true, hint: "" }));
});

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

describe("ProfilePage loading and identity boundaries", () => {
  it("renders the loading skeleton while auth status is loading", () => {
    useAuthMock.mockReturnValue({
      status: "loading",
      userId: null,
      generation: 0,
      user: null,
    });

    const { container } = render(<ProfilePage />);

    expect(container.querySelector(".h-16.w-16.rounded-full")).not.toBeNull();
    expect(screen.queryByText("Chave Pix")).not.toBeInTheDocument();
    expect(screen.queryByText("Ana Costa")).not.toBeInTheDocument();
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

  it("submits the phone Pix key with a +55 prefix and the verified user id first", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByText("E-mail"));
    await user.click(screen.getByRole("button", { name: "Telefone" }));

    const input = screen.getByPlaceholderText("(11) 99999-9999");
    await user.type(input, "11999998888");

    await user.click(screen.getByRole("button", { name: /salvar/i }));

    expect(updatePixKeyMock).toHaveBeenCalledTimes(1);
    // The authenticated user id must be the FIRST argument so the action can
    // re-check it against fresh server auth.
    expect(updatePixKeyMock.mock.calls[0][0]).toBe("u1");
    const formData = updatePixKeyMock.mock.calls[0][1];
    expect(formData.get("pixKeyType")).toBe("phone");
    expect(formData.get("pixKey")).toBe("+5511999998888");
  });
});

describe("ProfilePage identity-keyed state", () => {
  it("discards an in-progress Pix draft when the identity changes", async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(authenticatedAs(userA, 0));
    const { rerender } = render(<ProfilePage />);

    await user.click(screen.getByText("E-mail"));
    await user.click(screen.getByRole("button", { name: "Telefone" }));
    await user.type(
      screen.getByPlaceholderText("(11) 99999-9999"),
      "11999998888",
    );
    expect(screen.getByDisplayValue("(11) 99999-8888")).toBeInTheDocument();

    // Account switches to a different user and epoch. The key changes, so the
    // old editor and its draft unmount; a fresh one mounts with no draft.
    useAuthMock.mockReturnValue(authenticatedAs(userB, 1));
    rerender(<ProfilePage />);

    expect(screen.queryByDisplayValue("(11) 99999-8888")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("(11) 99999-9999"),
    ).not.toBeInTheDocument();
  });

  it("ignores a save result that resolves after the identity changed", async () => {
    // A save whose server reply lands after the account switched must not
    // toast or reload: the keyed editor it was issued for is already gone.
    const saveDeferred = deferred<{ success: true; hint: string }>();
    updatePixKeyMock.mockImplementation(() => saveDeferred.promise);

    const user = userEvent.setup();
    useAuthMock.mockReturnValue(authenticatedAs(userA, 0));
    const { rerender } = render(<ProfilePage />);

    await user.click(screen.getByText("E-mail"));
    await user.click(screen.getByRole("button", { name: "Telefone" }));
    await user.type(
      screen.getByPlaceholderText("(11) 99999-9999"),
      "11999998888",
    );
    await user.click(screen.getByRole("button", { name: /salvar/i }));

    expect(updatePixKeyMock).toHaveBeenCalledTimes(1);

    // The action is pending. Switch accounts; the keyed editor unmounts.
    useAuthMock.mockReturnValue(authenticatedAs(userB, 1));
    rerender(<ProfilePage />);

    // Resolve the in-flight reply for the account the save was issued for.
    saveDeferred.resolve({ success: true, hint: "" });
    const { promise: flushed, resolve: flush } = deferred<void>();
    setTimeout(flush, 0);
    await flushed;

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
