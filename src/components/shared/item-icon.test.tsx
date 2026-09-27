import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { unoptimized, ...imageProps } = props;
    void unoptimized;
    return <img alt="" {...imageProps} />;
  },
}));

import { ItemIcon } from "./item-icon";

describe("ItemIcon", () => {
  it("renders the SVG for a known key", () => {
    const { container } = render(<ItemIcon icon="beer" />);

    expect(container.querySelector("img")).toHaveAttribute("src", "/item-icons/beer.svg");
  });

  it("keeps the blank slot and renders no image for an unknown key", () => {
    const { container } = render(<ItemIcon icon="caviar" />);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector('span[aria-hidden="true"]')).toBeInTheDocument();
  });
});
