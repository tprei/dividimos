import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddParticipantByHandle } from "./add-participant-by-handle";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: null })),
        })),
      })),
    })),
    rpc: vi.fn(() => ({
      maybeSingle: vi.fn(() => Promise.resolve({ data: null })),
    })),
  })),
}));

describe("AddParticipantByHandle", () => {
  it("renders handle input with @ prefix", () => {
    render(
      <AddParticipantByHandle
        onAdd={vi.fn()}
        onCancel={vi.fn()}
        excludeIds={[]}
      />,
    );

    expect(screen.getByText("@")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/handle/)).toBeInTheDocument();
  });

  it("replaces spaces with periods in handle input", async () => {
    render(
      <AddParticipantByHandle
        onAdd={vi.fn()}
        onCancel={vi.fn()}
        excludeIds={[]}
      />,
    );

    const input = screen.getByPlaceholderText(/handle/);
    fireEvent.change(input, { target: { value: "test handle" } });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/handle/)).toHaveValue("test.handle");
    });
  });

  it("replaces multiple spaces with multiple periods", async () => {
    render(
      <AddParticipantByHandle
        onAdd={vi.fn()}
        onCancel={vi.fn()}
        excludeIds={[]}
      />,
    );

    const input = screen.getByPlaceholderText(/handle/);
    fireEvent.change(input, { target: { value: "a b c" } });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/handle/)).toHaveValue("a.b.c");
    });
  });

  it("preserves other characters while replacing spaces", async () => {
    render(
      <AddParticipantByHandle
        onAdd={vi.fn()}
        onCancel={vi.fn()}
        excludeIds={[]}
      />,
    );

    const input = screen.getByPlaceholderText(/handle/);
    fireEvent.change(input, { target: { value: "test user name" } });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/handle/)).toHaveValue("test.user.name");
    });
  });

  it("does not show 'Buscando...' text (uses skeleton instead)", async () => {
    const user = userEvent.setup();
    render(
      <AddParticipantByHandle
        onAdd={vi.fn()}
        onCancel={vi.fn()}
        excludeIds={[]}
      />,
    );

    const input = screen.getByPlaceholderText(/handle/);
    await user.type(input, "alice");

    // Click the search button (the shadcn Button with data-slot)
    const searchBtn = document.querySelector("[data-slot='button']") as HTMLElement;
    await user.click(searchBtn);

    // After search resolves, should show not-found and never old "Buscando..." text
    await waitFor(() => {
      expect(screen.getByText(/Nenhum usuario encontrado/)).toBeInTheDocument();
    });
    expect(screen.queryByText("Buscando...")).not.toBeInTheDocument();
  });
});
