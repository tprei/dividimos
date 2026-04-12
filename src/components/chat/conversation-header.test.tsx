import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConversationHeader } from "./conversation-header";
import type { UserProfile } from "@/types";

const mockBack = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: mockBack }),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

const counterparty: UserProfile = {
  id: "user-2",
  handle: "alice",
  name: "Alice Silva",
  avatarUrl: undefined,
};

describe("ConversationHeader", () => {
  it("renders counterparty name and handle", () => {
    render(<ConversationHeader counterparty={counterparty} />);

    expect(screen.getByText("Alice Silva")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
  });

  it("renders avatar with initials", () => {
    render(<ConversationHeader counterparty={counterparty} />);

    expect(screen.getByText("AS")).toBeInTheDocument();
  });

  it("renders back button", () => {
    render(<ConversationHeader counterparty={counterparty} />);

    const backButton = screen.getByLabelText("Voltar");
    expect(backButton).toBeInTheDocument();
  });

  it("calls router.back on back button click", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    render(<ConversationHeader counterparty={counterparty} />);

    await userEvent.click(screen.getByLabelText("Voltar"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("renders actions slot when provided", () => {
    render(
      <ConversationHeader
        counterparty={counterparty}
        actions={<button>Ação</button>}
      />,
    );

    expect(screen.getByText("Ação")).toBeInTheDocument();
  });

  it("does not render actions slot when omitted", () => {
    render(<ConversationHeader counterparty={counterparty} />);

    expect(screen.queryByRole("button", { name: "Ação" })).not.toBeInTheDocument();
  });
});
