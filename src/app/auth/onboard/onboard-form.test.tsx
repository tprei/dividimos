import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { User } from "@/types";
import type { AuthIdentitySnapshot } from "@/hooks/use-auth";
import type { CompleteOnboardingResult } from "./actions";
import { OnboardForm, type OnboardingDraftSeed } from "./onboard-form";

// --- Mocks --------------------------------------------------------------

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => useAuthMock() }));

const refreshMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, replace: replaceMock }),
}));

// --- Fixtures -----------------------------------------------------------

const USER_A: User = {
  id: "user-a",
  email: "ana@test.com",
  handle: "ana",
  name: "Ana Costa",
  pixKeyType: "email",
  pixKeyHint: "",
  onboarded: false,
  createdAt: "2026-01-01T00:00:00Z",
};

const USER_B: User = {
  id: "user-b",
  email: "bob@test.com",
  handle: "bob.silva",
  name: "Bob Silva",
  pixKeyType: "email",
  pixKeyHint: "",
  onboarded: false,
  createdAt: "2026-01-01T00:00:00Z",
};

const SEED_A: OnboardingDraftSeed = {
  sourceUserId: "user-a",
  email: "ana@test.com",
  name: "Ana Costa",
  handle: "ana",
};

const SEED_B: OnboardingDraftSeed = {
  sourceUserId: "user-b",
  email: "bob@test.com",
  name: "Bob Silva",
  handle: "bob.silva",
};

function authed(user: User, generation: number): AuthIdentitySnapshot {
  return { status: "authenticated", userId: user.id, generation, user };
}
function loading(generation: number): AuthIdentitySnapshot {
  return { status: "loading", userId: null, generation, user: null };
}
function unauthed(generation: number): AuthIdentitySnapshot {
  return { status: "unauthenticated", userId: null, generation, user: null };
}
function errored(userId: string, generation: number): AuthIdentitySnapshot {
  return { status: "error", userId, generation, user: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const actionMock = vi.fn<(fd: FormData) => Promise<CompleteOnboardingResult>>();

beforeEach(() => {
  useAuthMock.mockReset();
  actionMock.mockReset();
  refreshMock.mockClear();
  replaceMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

async function goToPixStep(user: UserEvent) {
  await screen.findByDisplayValue("Ana Costa");
  await user.click(screen.getByRole("button", { name: /Continuar/i }));
  await screen.findByRole("heading", { name: "Chave Pix" });
}

describe("OnboardForm UI carry-over", () => {
  it("offers the Telefone option on the Pix step", async () => {
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);

    expect(screen.getByRole("button", { name: "Telefone" })).toBeInTheDocument();
  });

  it("switches placeholder and inputMode to numeric when Telefone is selected", async () => {
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: "Telefone" }));

    const input = await screen.findByPlaceholderText("(11) 99999-9999");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("formats a typed phone number and submits exactly four keys with the +55 prefix", async () => {
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    actionMock.mockResolvedValue({ kind: "completed", redirectTo: "/app" });
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: "Telefone" }));

    const input = await screen.findByPlaceholderText("(11) 99999-9999");
    fireEvent.change(input, { target: { value: "11999998888" } });
    await waitFor(() =>
      expect(screen.getByPlaceholderText("(11) 99999-9999")).toHaveValue(
        "(11) 99999-8888",
      ),
    );

    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));

    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    const fd = actionMock.mock.calls[0][0];
    expect(Array.from(fd.keys())).toEqual([
      "name",
      "handle",
      "pixKey",
      "pixKeyType",
    ]);
    expect(fd.get("pixKeyType")).toBe("phone");
    expect(fd.get("pixKey")).toBe("+5511999998888");
  });
});

describe("OnboardForm identity boundaries", () => {
  it("hides fields on a loading boundary without refreshing", async () => {
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const { rerender } = render(
      <OnboardForm seed={SEED_A} action={actionMock} />,
    );
    expect(screen.getByDisplayValue("Ana Costa")).toBeInTheDocument();

    useAuthMock.mockReturnValue(loading(2));
    rerender(<OnboardForm seed={SEED_A} action={actionMock} />);

    expect(screen.queryByDisplayValue("Ana Costa")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("hides fields and refreshes exactly once on an unauthenticated boundary", async () => {
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const { rerender } = render(
      <OnboardForm seed={SEED_A} action={actionMock} />,
    );

    useAuthMock.mockReturnValue(unauthed(2));
    rerender(<OnboardForm seed={SEED_A} action={actionMock} />);

    expect(screen.queryByDisplayValue("Ana Costa")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    // A repeat rerender on the same tuple does not refresh again.
    rerender(<OnboardForm seed={SEED_A} action={actionMock} />);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("hides A's values, refreshes once, then renders B's fresh profile step", async () => {
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const { rerender } = render(
      <OnboardForm seed={SEED_A} action={actionMock} />,
    );
    expect(screen.getByDisplayValue("Ana Costa")).toBeInTheDocument();

    useAuthMock.mockReturnValue(authed(USER_B, 2));
    rerender(<OnboardForm seed={SEED_A} action={actionMock} />);

    expect(screen.queryByDisplayValue("Ana Costa")).not.toBeInTheDocument();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    // Server refresh supplies B's seed; the draft remounts fresh at profile.
    useAuthMock.mockReturnValue(authed(USER_B, 2));
    rerender(<OnboardForm seed={SEED_B} action={actionMock} />);

    expect(screen.getByDisplayValue("Bob Silva")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Seu perfil" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Chave Pix" }),
    ).not.toBeInTheDocument();
  });

  it("drops a deferred A/g1 completed result after a direct A/g2 rerender", async () => {
    const d = deferred<CompleteOnboardingResult>();
    actionMock.mockReturnValue(d.promise);
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    const { rerender } = render(
      <OnboardForm seed={SEED_A} action={actionMock} />,
    );

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));

    // Bump generation: the g1 draft unmounts, g2 mounts fresh at profile.
    useAuthMock.mockReturnValue(authed(USER_A, 2));
    rerender(<OnboardForm seed={SEED_A} action={actionMock} />);
    expect(
      screen.getByRole("heading", { name: "Seu perfil" }),
    ).toBeInTheDocument();

    d.resolve({ kind: "completed", redirectTo: "/app" });
    await d.promise.catch(() => undefined);
    await Promise.resolve();

    // No navigation, no refresh, no error, g2 untouched.
    expect(replaceMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Erro ao salvar/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Seu perfil" }),
    ).toBeInTheDocument();
  });

  it("drops a deferred A/g1 rejection across A→null→B", async () => {
    const d = deferred<CompleteOnboardingResult>();
    actionMock.mockReturnValue(d.promise);
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    const { rerender } = render(
      <OnboardForm seed={SEED_A} action={actionMock} />,
    );

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));

    useAuthMock.mockReturnValue(unauthed(2));
    rerender(<OnboardForm seed={SEED_A} action={actionMock} />);
    useAuthMock.mockReturnValue(authed(USER_B, 3));
    rerender(<OnboardForm seed={SEED_B} action={actionMock} />);

    // A late rejection from the gone g1 draft surfaces no error.
    await d.resolve({ kind: "rejected", reason: "save_failed" });
    await Promise.resolve();

    expect(screen.queryByText(/Erro ao salvar/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Seu perfil" }),
    ).toBeInTheDocument();
  });

  it("unmounts the draft and refreshes once on identity_changed, with no field error", async () => {
    actionMock.mockResolvedValue({
      kind: "rejected",
      reason: "identity_changed",
    });
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: /Começar a usar/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Handle deve ter/i)).not.toBeInTheDocument();
  });

  it("unmounts the draft and refreshes once on unauthenticated outcome, with no field error", async () => {
    actionMock.mockResolvedValue({
      kind: "rejected",
      reason: "unauthenticated",
    });
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: /Começar a usar/i }),
    ).not.toBeInTheDocument();
  });
});

describe("OnboardForm error boundaries", () => {
  it("renders only a non-PII retry that calls router.refresh on provider error", async () => {
    useAuthMock.mockReturnValue(errored("user-a", 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /Tentar de novo/i });
    await user.click(retry);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("renders only a non-PII retry that calls router.refresh on profile_unavailable", async () => {
    actionMock.mockResolvedValue({
      kind: "rejected",
      reason: "profile_unavailable",
    });
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Tentar de novo/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Tentar de novo/i }));
    expect(refreshMock).toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe("OnboardForm reason → step mapping", () => {
  it("invalid_handle returns to the profile step with a handle error", async () => {
    actionMock.mockResolvedValue({ kind: "rejected", reason: "invalid_handle" });
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));

    await screen.findByRole("heading", { name: "Seu perfil" });
    expect(
      screen.queryByRole("heading", { name: "Chave Pix" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Handle deve ter entre 3 e 20/i),
    ).toBeInTheDocument();
  });

  it("handle_taken returns to the profile step with a handle error", async () => {
    actionMock.mockResolvedValue({ kind: "rejected", reason: "handle_taken" });
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));

    await screen.findByRole("heading", { name: "Seu perfil" });
    expect(screen.getByText(/Handle já em uso/i)).toBeInTheDocument();
  });

  it("invalid_pix_key stays on the Pix step with a Pix error", async () => {
    actionMock.mockResolvedValue({ kind: "rejected", reason: "invalid_pix_key" });
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));

    await screen.findByText(/Chave Pix inválida/i);
    expect(
      screen.getByRole("heading", { name: "Chave Pix" }),
    ).toBeInTheDocument();
  });

  it("save_failed stays retryable on the Pix step", async () => {
    actionMock.mockResolvedValue({ kind: "rejected", reason: "save_failed" });
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));

    await screen.findByText(/Erro ao salvar/i);
    expect(
      screen.getByRole("button", { name: /Começar a usar/i }),
    ).not.toBeDisabled();
  });
});

describe("OnboardForm completion", () => {
  it("navigates via router.replace(redirectTo) then refresh on completed", async () => {
    actionMock.mockResolvedValue({ kind: "completed", redirectTo: "/dashboard" });
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("recovers from a transport rejection by retrying to completion", async () => {
    actionMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ kind: "completed", redirectTo: "/app" });
    useAuthMock.mockReturnValue(authed(USER_A, 1));
    const user = userEvent.setup();
    render(<OnboardForm seed={SEED_A} action={actionMock} />);

    await goToPixStep(user);
    await user.click(screen.getByRole("button", { name: /Começar a usar/i }));
    await screen.findByText(/Erro ao salvar/i);

    const retry = await screen.findByRole("button", { name: /Começar a usar/i });
    await user.click(retry);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/app"));
  });
});
