import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Mock next/image before importing the component
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill, priority, ...rest } = props;
    void fill;
    return <img alt="" data-priority={priority ? "true" : undefined} {...rest} />;
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

  it("drops a parenthesised aside from the initials", () => {
    // The bots are named "Ana (bot)", which used to initial as "A(".
    render(<UserAvatar name="Ana (bot)" />);
    expect(screen.getByText("AN")).toBeInTheDocument();
  });

  it("renders image when avatarUrl provided and standalone", () => {
    render(<UserAvatar name="Maria" avatarUrl="https://example.com/photo.jpg" standalone />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("alt", "Maria");
  });

  it("renders image with empty alt by default (decorative)", () => {
    render(<UserAvatar name="Maria" avatarUrl="https://example.com/photo.jpg" />);
    const img = screen.getByAltText("");
    expect(img).toBeInTheDocument();
  });

  it("is decorative by default to avoid duplicate accessible names next to visible text", () => {
    const { container } = render(<UserAvatar id="person-1" name="Ana de" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });


  it("renders the verified bot glyph when isBot is set", () => {
    render(<UserAvatar name="Ana (bot)" isBot />);
    expect(screen.getByRole("img", { name: "Bot verificado" })).toBeInTheDocument();
  });

  it("suppresses the verified bot glyph for size xs", () => {
    render(<UserAvatar name="Ana (bot)" size="xs" isBot />);
    expect(screen.queryByRole("img", { name: "Bot verificado" })).toBeNull();
  });

  it("does not render the verified bot glyph by default", () => {
    render(<UserAvatar name="Ana" />);
    expect(screen.queryByRole("img", { name: "Bot verificado" })).toBeNull();
  });

  it("keeps the same tone after a rename and uses initials after a photo fails", () => {
    const { rerender } = render(<UserAvatar id="person-1" name="Ana de" standalone />);
    const tone = screen.getByRole("img", { name: "Ana de" }).style.backgroundColor;
    expect(screen.getByText("AN")).toBeInTheDocument();
    rerender(<UserAvatar id="person-1" name="Ana Souza" avatarUrl="https://example.com/broken.jpg" standalone />);
    fireEvent.error(screen.getByRole("img", { name: "Ana Souza" }));
    expect(screen.getByRole("img", { name: "Ana Souza" }).style.backgroundColor).toBe(tone);
    expect(screen.getByText("AS")).toBeInTheDocument();
  });

  it("shows the initials behind the photo and fades the image in on load", () => {
    render(<UserAvatar name="Maria Silva" avatarUrl="https://example.com/photo.jpg" />);
    expect(screen.getByText("MS")).toBeInTheDocument();
    const img = screen.getByAltText("");
    expect(img.className).toContain("opacity-0");
    fireEvent.load(img);
    expect(img.className).toContain("opacity-100");
  });

  it("pulses the tone layer only while the photo loads", () => {
    render(<UserAvatar name="Maria Silva" avatarUrl="https://example.com/photo.jpg" />);
    const toneLayer = screen.getByText("MS");
    expect(toneLayer.className).toContain("animate-pulse");
    expect(toneLayer.className).toContain("motion-reduce:animate-none");
    fireEvent.load(screen.getByAltText(""));
    expect(toneLayer.className).not.toContain("animate-pulse");
  });

  describe("cached photo already complete at mount", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("renders an already-decoded photo instantly, without fade or pulse", () => {
      vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
      vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(64);

      render(<UserAvatar name="Maria Silva" avatarUrl="https://example.com/photo.jpg" />);

      const img = screen.getByAltText("");
      expect(img.className).toContain("opacity-100");
      expect(img.className).not.toContain("opacity-0");
      expect(screen.getByText("MS").className).not.toContain("animate-pulse");
    });

    it("keeps the fade for a photo that has not finished loading", () => {
      vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
      vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);

      render(<UserAvatar name="Maria Silva" avatarUrl="https://example.com/photo.jpg" />);

      expect(screen.getByAltText("").className).toContain("opacity-0");
      expect(screen.getByText("MS").className).toContain("animate-pulse");
    });

    it("ignores a broken cached response (complete but zero-width)", () => {
      vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
      vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);

      render(<UserAvatar name="Maria Silva" avatarUrl="https://example.com/photo.jpg" />);

      expect(screen.getByAltText("").className).toContain("opacity-0");
    });
  });
});
