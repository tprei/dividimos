import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoomHostControls, RoomHostMenu, RoomHostPerson } from "./room-host-controls";
import { RoomJoin } from "./room-join";
import { RoomShare } from "./room-share";

const { toCanvas } = vi.hoisted(() => ({
  toCanvas: vi.fn(() => Promise.resolve()),
}));
vi.mock("qrcode", () => ({ default: { toCanvas } }));

const participants = [
  { id: "person-1", ordinal: 0, displayName: "Bia", avatarUrl: null, isGuest: true, removed: false },
  { id: "person-2", ordinal: 1, displayName: "Caio", avatarUrl: null, isGuest: true, removed: false },
];

const shareProps = {
  url: "https://dividimos.test/room/room-id#secret",
  rotating: false,
  rotationDisabled: false,
  errorMessage: null,
  onRotate: vi.fn(),
};

/**
 * The route owns whether the invite is showing, so the test owns it too.
 */
function ControlledShare(
  props: Omit<React.ComponentProps<typeof RoomShare>, "open" | "onOpenChange"> & {
    onOpenChange?: (open: boolean) => void;
  },
) {
  const { onOpenChange, ...rest } = props;
  const [open, setOpen] = React.useState(false);
  return (
    <RoomShare
      {...rest}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    />
  );
}

describe("RoomJoin", () => {
  it("validates and trims the no-login display name", async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    render(
      <RoomJoin
        identity={{ status: "guest" }}
        onRetryIdentity={vi.fn()}
        pending={false}
        onJoin={onJoin}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Entrar na sala" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Digite um nome");

    await user.type(screen.getByLabelText("Seu nome"), "  Bia  ");
    await user.click(screen.getByRole("button", { name: "Entrar na sala" }));
    expect(onJoin).toHaveBeenCalledWith("Bia");
  });

  it("joins a connected account without asking for a name", async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    const { rerender } = render(
      <RoomJoin
        identity={{ status: "account", name: "Bia" }}
        onRetryIdentity={vi.fn()}
        pending={false}
        onJoin={onJoin}
      />,
    );

    expect(screen.queryByLabelText("Seu nome")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Entrar na sala" }));
    expect(onJoin).toHaveBeenCalledWith("");

    rerender(
      <RoomJoin
        identity={{ status: "account", name: null }}
        onRetryIdentity={vi.fn()}
        pending={false}
        onJoin={onJoin}
      />,
    );
    expect(screen.queryByLabelText("Seu nome")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Entrar na sala" }));
    expect(onJoin).toHaveBeenCalledTimes(2);
  });

  it("shows the identity check and a retry on failure without a join action", async () => {
    const user = userEvent.setup();
    const onRetryIdentity = vi.fn();
    const { rerender } = render(
      <RoomJoin
        identity={{ status: "loading" }}
        onRetryIdentity={onRetryIdentity}
        pending={false}
        onJoin={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Entrar na sala" })).not.toBeInTheDocument();

    rerender(
      <RoomJoin
        identity={{ status: "error", message: "Deu ruim aqui. Tente de novo em instantes." }}
        onRetryIdentity={onRetryIdentity}
        pending={false}
        onJoin={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Deu ruim aqui");
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetryIdentity).toHaveBeenCalledOnce();
  });
});

describe("RoomShare", () => {
  it("opens the named invite dialog and returns focus to Convidar on close", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ControlledShare {...shareProps} onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Convidar" }));
    const dialog = screen.getByRole("dialog", { name: "Sala de itens" });
    expect(within(dialog).queryByText(/secret/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Entrar na sala" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Convidar" })).toHaveFocus(),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps generation failures inside the dialog and disables copying while rotating", async () => {
    const user = userEvent.setup();
    const onRotate = vi.fn();
    const { rerender } = render(
      <RoomShare
        {...shareProps}
        open
        onOpenChange={vi.fn()}
        errorMessage="Não foi possível gerar o convite. Tente novamente."
        onRotate={onRotate}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Sala de itens" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Não foi possível gerar o convite");
    await user.click(within(dialog).getByRole("button", { name: "Gerar novo link" }));
    expect(onRotate).toHaveBeenCalledOnce();

    rerender(
      <RoomShare
        {...shareProps}
        open
        onOpenChange={vi.fn()}
        rotating
        errorMessage="Não foi possível gerar o convite. Tente novamente."
        onRotate={onRotate}
      />,
    );
    expect(within(dialog).getByRole("button", { name: "Gerando convite..." })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Copiar link" })).toBeDisabled();

    rerender(
      <RoomShare {...shareProps} open onOpenChange={vi.fn()} rotationDisabled onRotate={onRotate} />,
    );
    expect(within(dialog).getByRole("button", { name: "Gerar novo link" })).toBeDisabled();
  });

  it("generates an invite rather than entering when this device has none", async () => {
    const user = userEvent.setup();
    const onRotate = vi.fn();
    render(
      <RoomShare {...shareProps} url={null} open onOpenChange={vi.fn()} onRotate={onRotate} />,
    );

    const dialog = screen.getByRole("dialog", { name: "Sala de itens" });
    expect(within(dialog).queryByLabelText("QR code do convite")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Entrar na sala" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Copiar link" })).toBeDisabled();
    const generate = within(dialog).getByRole("button", { name: "Gerar convite" });
    expect(generate).toBeEnabled();
    await user.click(generate);
    expect(onRotate).toHaveBeenCalledOnce();
  });
});

describe("Host controls", () => {
  it("removes through the anchored person confirmation and blocks pending removal", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const { rerender } = render(<RoomHostPerson participant={participants[1]} label="Caio" disabled removable onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "Caio" }));
    expect(screen.getByRole("button", { name: "Remover da sala" })).toBeDisabled();
    rerender(<RoomHostPerson participant={participants[1]} label="Caio" disabled={false} removable onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "Remover da sala" }));
    expect(onRemove).toHaveBeenCalledWith("person-2");
    expect(screen.queryByRole("button", { name: "Remover da sala" })).not.toBeInTheDocument();
  });

  it("keeps the host non-removable and closed-room people read-only", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RoomHostPerson participant={participants[0]} label="Você" disabled={false} removable onRemove={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Bia" }));
    expect(screen.queryByRole("button", { name: /Remover/ })).not.toBeInTheDocument();
    rerender(<RoomHostPerson participant={participants[1]} label="Caio" disabled={false} removable={false} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Remover/ })).not.toBeInTheDocument();
  });

  it("gates closing and returns closed rooms to review", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onReturnToReview = vi.fn();
    const { rerender } = render(<RoomHostControls unownedLineCount={1} complete={false} closed={false} onClose={onClose} />);
    expect(screen.getByRole("button", { name: /Encerrar sala/ })).toBeDisabled();
    rerender(<RoomHostControls unownedLineCount={0} complete closed={false} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Encerrar sala" }));
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<RoomHostControls unownedLineCount={0} complete closed onClose={onClose} onReturnToReview={onReturnToReview} />);
    await user.click(screen.getByRole("button", { name: "Voltar à revisão" }));
    expect(onReturnToReview).toHaveBeenCalledOnce();
  });

  it("requires the existing dialog confirmation after opening Mais", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<RoomHostMenu onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Mais" }));
    await user.click(screen.getByRole("button", { name: "Cancelar sala" }));
    expect(onCancel).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Cancelar sala" });
    await user.click(within(dialog).getByRole("button", { name: "Cancelar sala" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
