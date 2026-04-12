import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ActivityCardSkeleton,
  ContactAvatarSkeleton,
  ContactRowSkeleton,
  GroupRowSkeleton,
  ModalLoadingSkeleton,
  Skeleton,
  BillCardSkeleton,
  DashboardSkeleton,
} from "./skeleton";

describe("Skeleton", () => {
  it("renders with pulse animation by default", () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    const el = container.firstElementChild!;
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("bg-muted");
  });

  it("renders with shimmer animation when variant is shimmer", () => {
    const { container } = render(
      <Skeleton variant="shimmer" className="h-4 w-20" />,
    );
    const el = container.firstElementChild!;
    expect(el.className).toContain("shimmer");
    expect(el.className).not.toContain("animate-pulse");
  });

  it("merges custom className", () => {
    const { container } = render(<Skeleton className="h-10 w-10" />);
    const el = container.firstElementChild!;
    expect(el.className).toContain("h-10");
    expect(el.className).toContain("w-10");
  });
});

describe("ContactAvatarSkeleton", () => {
  it("renders avatar circle and text placeholder", () => {
    const { container } = render(<ContactAvatarSkeleton />);
    const skeletons = container.querySelectorAll("[class*='rounded']");
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("ContactRowSkeleton", () => {
  it("renders avatar and two text lines", () => {
    const { container } = render(<ContactRowSkeleton />);
    const skeletons = container.querySelectorAll("[class*='shimmer']");
    expect(skeletons.length).toBe(3);
  });
});

describe("GroupRowSkeleton", () => {
  it("renders group icon, text lines, and member avatars", () => {
    const { container } = render(<GroupRowSkeleton />);
    const circles = container.querySelectorAll("[class*='rounded-full']");
    expect(circles.length).toBe(3);
  });
});

describe("ActivityCardSkeleton", () => {
  it("renders icon, text lines, and amount placeholders", () => {
    const { container } = render(<ActivityCardSkeleton />);
    const skeletons = container.querySelectorAll("[class*='shimmer']");
    expect(skeletons.length).toBe(5);
  });
});

describe("ModalLoadingSkeleton", () => {
  it("renders spinner and text placeholder", () => {
    const { container } = render(<ModalLoadingSkeleton />);
    const spinner = container.querySelector("[class*='animate-spin']");
    expect(spinner).toBeTruthy();
  });
});

describe("BillCardSkeleton", () => {
  it("renders without crashing", () => {
    const { container } = render(<BillCardSkeleton />);
    expect(container.firstElementChild).toBeTruthy();
  });
});

describe("DashboardSkeleton", () => {
  it("renders without crashing", () => {
    const { container } = render(<DashboardSkeleton />);
    expect(container.firstElementChild).toBeTruthy();
  });
});
