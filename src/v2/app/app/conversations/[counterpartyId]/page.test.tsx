import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConversationPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ counterpartyId: "user-bob" }),
}));

vi.mock("./conversation-page-client", () => ({
  ConversationPageClient: ({ counterpartyId }: { counterpartyId: string }) => (
    <div data-testid="client-page">{counterpartyId}</div>
  ),
}));

describe("ConversationPage", () => {
  it("renders ConversationPageClient with counterpartyId from params", () => {
    render(<ConversationPage />);
    const client = screen.getByTestId("client-page");
    expect(client.textContent).toBe("user-bob");
  });
});
