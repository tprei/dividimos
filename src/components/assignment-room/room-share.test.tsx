import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomShare } from "./room-share";
import type { AssignmentRoomCodeState } from "@/types/assignment-room";

const url = "https://dividimos.test/room/room-id#token";
const props = {
  url,
  code: { status: "idle" } satisfies AssignmentRoomCodeState,
  codeEntryAddress: "dividimos.app/room",
  onRetryCode: vi.fn(),
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

describe("RoomShare spoken code", () => {
  it("shows the spoken code and entry address even without a link", () => {
    render(
      <RoomShare
        {...props}
        url={null}
        code={{ status: "ready", display: "cafuné-legal", expiresAt: "2026-10-03T12:15:00Z" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Ou fala o código" })).toBeInTheDocument();
    expect(screen.getByText("cafuné-legal")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "cafuné-legal" })).toBeInTheDocument();
    expect(screen.getByText("É")).toHaveAttribute("data-code-tile");
    expect(screen.getByText(/Quem for entrar abre/)).toHaveTextContent(
      "Quem for entrar abre dividimos.app/room e digita. Vale por 15 minutos.",
    );
  });

  it("keeps the expiry guidance when the entry address is unavailable", () => {
    render(
      <RoomShare
        {...props}
        codeEntryAddress={null}
        code={{ status: "ready", display: "pipoca-moleza", expiresAt: "2026-10-03T12:15:00Z" }}
      />,
    );

    expect(screen.getByText(/Quem for entrar digita/)).toHaveTextContent(
      "Quem for entrar digita o código. Vale por 15 minutos.",
    );
  });

  it("announces code generation", () => {
    render(<RoomShare {...props} code={{ status: "issuing" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Gerando código...");
  });

  it("hides a ready code while the link rotates, since rotation kills it", () => {
    render(
      <RoomShare
        {...props}
        rotating
        code={{ status: "ready", display: "pipoca-moleza", expiresAt: "2026-10-03T12:15:00Z" }}
      />,
    );

    expect(screen.queryByText("pipoca-moleza")).not.toBeInTheDocument();
    expect(screen.getByText("Gerando código...")).toBeInTheDocument();
  });

  it("lets the host retry a failed code", async () => {
    const user = userEvent.setup();
    const onRetryCode = vi.fn();
    render(
      <RoomShare
        {...props}
        code={{ status: "error", message: "Não deu para gerar o código da sala. Tente de novo." }}
        onRetryCode={onRetryCode}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Não deu para gerar o código da sala.");
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onRetryCode).toHaveBeenCalledOnce();
  });

  it("omits the code block while idle", () => {
    render(<RoomShare {...props} />);
    expect(screen.queryByRole("heading", { name: "Ou fala o código" })).not.toBeInTheDocument();
  });
});
