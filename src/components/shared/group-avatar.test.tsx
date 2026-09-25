import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { useCallback } from "react";

function MockNextImage(props: Record<string, unknown>) {
  const { fill, unoptimized, onError, ...rest } = props;
  void fill;
  void unoptimized;
  const ownRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      if (onError) {
        // Next.js Image ownRef re-assigns img.src when onError is provided
        const attr = img.getAttribute("src");
        img.src = img.src;
        if (attr) img.setAttribute("src", attr);
      }
    },
    [onError],
  );
  return (
    <img
      ref={ownRef}
      alt={typeof rest.alt === "string" ? rest.alt : ""}
      onError={onError as React.ReactEventHandler<HTMLImageElement>}
      {...rest}
    />
  );
}

vi.mock("next/image", () => ({
  default: MockNextImage,
}));

import { GroupAvatar } from "./group-avatar";

describe("GroupAvatar", () => {
  it("renders the fixed emoji as an accessible group image", () => {
    render(
      <GroupAvatar
        name="Viagem"
        groupId="group-1"
        avatar={{ kind: "emoji", emoji: "✈️" }}
      />,
    );

    expect(screen.getByRole("img", { name: "Viagem" })).toHaveTextContent("✈️");
  });

  it("uses initials without a saved avatar", () => {
    render(<GroupAvatar name="Viagem" groupId="group-1" avatar={{ kind: "initials" }} />);

    expect(screen.getByText("VI")).toBeInTheDocument();
  });

  it("falls back after a broken photo and resets for a new photo id", () => {
    const { rerender } = render(
      <GroupAvatar name="Viagem" groupId="group-1" avatar={{ kind: "photo", photoId: "photo-1" }} />,
    );
    const image = screen.getByRole("img", { name: "Viagem" });
    expect(image).toHaveAttribute(
      "src",
      "/api/groups/group-1/avatar?photoId=photo-1",
    );

    fireEvent.error(image);
    expect(screen.getByText("VI")).toBeInTheDocument();

    rerender(
      <GroupAvatar name="Viagem" groupId="group-1" avatar={{ kind: "photo", photoId: "photo-2" }} />,
    );
    expect(screen.getByRole("img", { name: "Viagem" })).toHaveAttribute(
      "src",
      "/api/groups/group-1/avatar?photoId=photo-2",
    );
  });

  it("does not reassign img.src on parent re-renders when photo id is unchanged", () => {
    const srcSpy = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    try {
      const { rerender } = render(
        <GroupAvatar
          name="Viagem"
          groupId="group-1"
          avatar={{ kind: "photo", photoId: "photo-1" }}
        />,
      );
      expect(srcSpy).toHaveBeenCalled();
      srcSpy.mockClear();

      rerender(
        <GroupAvatar
          name="Viagem Atualizada"
          groupId="group-1"
          avatar={{ kind: "photo", photoId: "photo-1" }}
        />,
      );
      expect(srcSpy).not.toHaveBeenCalled();
    } finally {
      srcSpy.mockRestore();
    }
  });
});
