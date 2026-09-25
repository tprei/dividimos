import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GuestAvatar } from "./guest-avatar";

describe("GuestAvatar", () => {
  it("identifies a guest by initials without treating Portuguese particles as surnames", () => {
    render(<GuestAvatar id="guest-ana" name="Ana de" standalone />);
    expect(screen.getByRole("img", { name: "Ana de" })).toHaveTextContent("AN");
  });

  it("is decorative by default when adjacent to a label", () => {
    const { container } = render(<GuestAvatar id="guest-ana" name="Ana de" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });
});