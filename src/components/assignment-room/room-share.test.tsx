import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomShare } from "./room-share";

const url = "https://dividimos.test/room/room-id#token";
const props = {
  url,
  open: true,
  onOpenChange: vi.fn(),
  rotating: false,
  rotationDisabled: false,
  errorMessage: null,
  onRotate: vi.fn(),
};

function setNavigatorShare(value: unknown) {
  Object.defineProperty(window.navigator, "share", {
    configurable: true,
    value,
  });
}

describe("RoomShare native sharing", () => {
  beforeEach(() => {
    setNavigatorShare(undefined);
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: undefined,
    });
  });

  it("hides native sharing when the browser does not provide it", () => {
    render(<RoomShare {...props} />);
    expect(screen.queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();
  });
  it("shows the latest activity inside the invite dialog", () => {
    render(
      <RoomShare
        {...props}
        latestActivity={{
          kind: "joined",
          revision: 2,
          observedAt: Date.parse("2026-09-21T14:32:00Z"),
          burstStartedAt: Date.parse("2026-09-21T14:32:00Z"),
          participantIds: ["person-1"],
        }}
        participants={[
          {
            id: "person-1",
            ordinal: 0,
            displayName: "Bia",
            avatarUrl: null,
            isGuest: true,
            removed: false,
          },
        ]}
        items={[]}
        connected
      />,
    );

    expect(screen.getByText("Bia entrou")).toBeInTheDocument();
    expect(screen.getByText("Bia entrou")).toHaveAttribute("aria-live", "polite");
  });

  it("shares the current invite URL", async () => {
    const share = vi.fn(async () => undefined);
    setNavigatorShare(share);
    const user = userEvent.setup();
    render(<RoomShare {...props} />);

    await user.click(screen.getByRole("button", { name: "Compartilhar" }));

    expect(share).toHaveBeenCalledWith({ title: "Dividimos", url });
  });

  it("reports a non-cancel share failure", async () => {
    const share = vi.fn(async () => {
      throw new Error("share failed");
    });
    setNavigatorShare(share);
    const user = userEvent.setup();
    render(<RoomShare {...props} />);

    await user.click(screen.getByRole("button", { name: "Compartilhar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível compartilhar.");
  });

  it("does not report when the user cancels the share sheet", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("cancelled", "AbortError");
    });
    setNavigatorShare(share);
    const user = userEvent.setup();
    render(<RoomShare {...props} />);

    await user.click(screen.getByRole("button", { name: "Compartilhar" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
