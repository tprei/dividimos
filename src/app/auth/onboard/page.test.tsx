import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const completeOnboardingMock = vi.fn().mockResolvedValue(undefined);

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: "u1",
            email: "ana@test.com",
            user_metadata: { full_name: "Ana Costa" },
          },
        },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: vi.fn().mockResolvedValue({ data: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("./actions", () => ({
  completeOnboarding: (formData: FormData) => completeOnboardingMock(formData),
}));

import OnboardPage from "./page";

async function advanceToPixStep(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByDisplayValue("Ana Costa");
  await user.click(screen.getByRole("button", { name: /Continuar/i }));
  await screen.findByRole("heading", { name: "Chave Pix" });
}

describe("OnboardPage phone Pix key", () => {
  beforeEach(() => {
    completeOnboardingMock.mockClear();
  });

  it("renders the Telefone Pix key option on the Pix step", async () => {
    const user = userEvent.setup();
    render(<OnboardPage />);

    await advanceToPixStep(user);

    expect(
      screen.getByRole("button", { name: "Telefone" }),
    ).toBeInTheDocument();
  });

  it("selecting Telefone switches placeholder and inputMode to numeric", async () => {
    const user = userEvent.setup();
    render(<OnboardPage />);

    await advanceToPixStep(user);
    await user.click(screen.getByRole("button", { name: "Telefone" }));

    const input = await screen.findByPlaceholderText("(11) 99999-9999");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("formats a typed phone number and submits with +55 prefix", async () => {
    const user = userEvent.setup();
    render(<OnboardPage />);

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
      expect(completeOnboardingMock).toHaveBeenCalledTimes(1);
    });
    const formData = completeOnboardingMock.mock.calls[0][0] as FormData;
    expect(formData.get("pixKeyType")).toBe("phone");
    expect(formData.get("pixKey")).toBe("+5511999998888");
  });
});
