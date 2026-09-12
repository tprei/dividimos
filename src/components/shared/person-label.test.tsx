import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersonLabel } from "./person-label";

describe("PersonLabel", () => {
  it("renders the name with an @-prefixed handle when given", () => {
    render(<PersonLabel name="Carol Souza" handle="carol" />);

    expect(screen.getByText("Carol Souza")).toBeInTheDocument();
    expect(screen.getByText("@carol")).toBeInTheDocument();
  });

  it("renders name-only when the handle is null (guests)", () => {
    render(<PersonLabel name="Bruno Convidado" handle={null} />);

    expect(screen.getByText("Bruno Convidado")).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("honours overrideName while still showing the handle", () => {
    render(<PersonLabel name="Tiago Silva" handle="tiago" overrideName="Eu" />);

    expect(screen.getByText("Eu")).toBeInTheDocument();
    expect(screen.getByText("@tiago")).toBeInTheDocument();
    expect(screen.queryByText("Tiago Silva")).not.toBeInTheDocument();
  });

  it("renders name-only when the handle is omitted", () => {
    render(<PersonLabel name="Dave Lima" />);

    expect(screen.getByText("Dave Lima")).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });
});
