import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

// No next/image mock here on purpose: commit 0d9f93cc dropped `fill` and every
// test suite mocked next/image, so nothing caught it. With the real component,
// an Image without `fill` and without width/height fails validation in this
// environment, so this test fails if the sizing regression ever returns.
import { UserAvatar } from "./user-avatar";

describe("UserAvatar photo sizing", () => {
  it("renders the photo filling the avatar box (regression: missing fill)", () => {
    const { container } = render(
      <UserAvatar id="person-1" name="Jennie" avatarUrl="https://lh3.googleusercontent.com/a/abc" />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("sizes", "44px");
    expect(img?.style.position).toBe("absolute");
  });

  it("sizes the optimized request for every avatar size", () => {
    const expected = { xs: "24px", sm: "32px", md: "44px", lg: "56px" };
    for (const [size, sizes] of Object.entries(expected)) {
      const { container, unmount } = render(
        <UserAvatar
          id="person-1"
          name="Jennie"
          avatarUrl="https://lh3.googleusercontent.com/a/abc"
          size={size as keyof typeof expected}
        />,
      );
      expect(container.querySelector("img")).toHaveAttribute("sizes", sizes);
      unmount();
    }
  });
});
