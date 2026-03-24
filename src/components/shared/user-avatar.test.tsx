import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next/image before importing the component
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill, ...rest } = props; // eslint-disable-line @typescript-eslint/no-unused-vars
    return <img alt="" {...rest} />; // eslint-disable-line @next/next/no-img-element
  },
}));

import { UserAvatar } from "./user-avatar";

describe("UserAvatar", () => {
  it("renders initials when no avatar URL", () => {
    render(<UserAvatar name="Maria Silva" />);
    expect(screen.getByText("MS")).toBeInTheDocument();
  });

  it("renders two-letter initials for single name", () => {
    render(<UserAvatar name="Jo" />);
    expect(screen.getByText("JO")).toBeInTheDocument();
  });

  it("uses first and last initial for multi-word names", () => {
    render(<UserAvatar name="Ana Beatriz Costa" />);
    expect(screen.getByText("AC")).toBeInTheDocument();
  });

  it("renders image when avatarUrl provided", () => {
    render(<UserAvatar name="Maria" avatarUrl="https://example.com/photo.jpg" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("alt", "Maria");
  });

  it("applies size classes", () => {
    const { container } = render(<UserAvatar name="Maria" size="lg" />);
    const el = container.firstElementChild;
    expect(el?.className).toContain("h-14");
    expect(el?.className).toContain("w-14");
  });

  it("applies custom className", () => {
    const { container } = render(<UserAvatar name="Maria" className="border-2" />);
    const el = container.firstElementChild;
    expect(el?.className).toContain("border-2");
  });
});
