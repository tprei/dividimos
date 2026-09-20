import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill, unoptimized, ...rest } = props;
    void fill;
    void unoptimized;
    return <img alt={typeof rest.alt === "string" ? rest.alt : ""} {...rest} />;
  },
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
});
