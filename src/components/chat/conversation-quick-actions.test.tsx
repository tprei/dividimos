import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConversationQuickActions } from "./conversation-quick-actions";

describe("ConversationQuickActions", () => {
  const defaultProps = {
    groupId: "group-123",
    counterpartyName: "Maria",
  };

  it("renders Cobrar and Dividir conta buttons", () => {
    render(<ConversationQuickActions {...defaultProps} />);

    expect(screen.getByText("Cobrar")).toBeInTheDocument();
    expect(screen.getByText("Dividir conta")).toBeInTheDocument();
  });

  it("links Cobrar to bill/new with single_amount type", () => {
    render(<ConversationQuickActions {...defaultProps} />);

    const link = screen.getByText("Cobrar").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/app/bill/new?groupId=group-123&type=single_amount&dm=Maria"
    );
  });

  it("links Dividir conta to bill/new with itemized type", () => {
    render(<ConversationQuickActions {...defaultProps} />);

    const link = screen.getByText("Dividir conta").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/app/bill/new?groupId=group-123&type=itemized&dm=Maria"
    );
  });

  it("encodes counterpartyName in the URL", () => {
    render(
      <ConversationQuickActions groupId="g1" counterpartyName="João & Maria" />
    );

    const link = screen.getByText("Cobrar").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/app/bill/new?groupId=g1&type=single_amount&dm=Jo%C3%A3o%20%26%20Maria"
    );
  });
});
