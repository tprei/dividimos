import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
});
