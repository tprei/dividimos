import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoomHostControls } from "./room-host-controls";
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

    expect(screen.getByText("Você entra como convidado, sem precisar criar conta.")).toBeInTheDocument();
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

    expect(screen.getByText(/Você entra como Bia\./)).toBeInTheDocument();
    expect(
      screen.getByText(/Ao registrar a conta, você recebe um convite para o grupo\./),
    ).toBeInTheDocument();
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
    expect(
      screen.getByText(/Você entra com sua conta conectada\./),
    ).toBeInTheDocument();
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

    expect(screen.getByText("Verificando sua conta...")).toBeInTheDocument();
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
    const dialog = screen.getByRole("dialog", { name: "Convide o pessoal" });
    expect(
      within(dialog).getByText(
        "Escaneie o QR ou copie o link. Quem já tem conta entra com ela; quem não tem entra com um nome.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/secret/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Voltar para a sala" }));
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

    const dialog = screen.getByRole("dialog", { name: "Convide o pessoal" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Não foi possível gerar o convite");
    await user.click(within(dialog).getByRole("button", { name: "Gerar novo convite" }));
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
    expect(within(dialog).getByRole("button", { name: "Gerar novo convite" })).toBeDisabled();
  });

  it("asks for a fresh invite when this device has none", () => {
    render(
      <RoomShare {...shareProps} url={null} open onOpenChange={vi.fn()} onRotate={vi.fn()} />,
    );

    const dialog = screen.getByRole("dialog", { name: "Convide o pessoal" });
    expect(
      within(dialog).getByText(
        "Este aparelho não tem o convite atual. Gere um novo para compartilhar.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Copiar link" })).toBeDisabled();
    const generate = within(dialog).getByRole("button", { name: "Gerar convite" });
    expect(generate).toBeEnabled();
  });
});

describe("RoomHostControls", () => {
  it("confirms claim release before removing a participant after opening Gerenciar pessoas", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <RoomHostControls
        participants={participants}
        fullyAssignedCount={0}
        totalItemCount={1}
        complete={false}
        closed={false}
        onRemove={onRemove}
        onClose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const disclosure = screen
      .getByText("Gerenciar pessoas")
      .closest("details") as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);
    await user.click(screen.getByText("Gerenciar pessoas"));
    expect(disclosure.open).toBe(true);
    expect(screen.getByRole("button", { name: /^Fechar escolhas/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remover Caio" }));
    expect(screen.getByText(/escolhas dessa pessoa serão liberadas/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remover e liberar itens" }));
    expect(onRemove).toHaveBeenCalledWith("person-2");
  });

  it("keeps participant removal unavailable while the room is closed", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onReturnToReview = vi.fn();
    render(
      <RoomHostControls
        participants={participants}
        fullyAssignedCount={2}
        totalItemCount={2}
        complete
        closed
        onRemove={onRemove}
        onReturnToReview={onReturnToReview}
        onClose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Gerenciar pessoas"));
    expect(screen.queryByRole("button", { name: "Remover Bia" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remover Caio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Fechar escolhas/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Voltar à revisão" }));
    expect(onReturnToReview).toHaveBeenCalledOnce();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("blocks the remove action while that participant's removal is pending", async () => {
    const user = userEvent.setup();
    render(
      <RoomHostControls
        participants={participants}
        fullyAssignedCount={0}
        totalItemCount={1}
        complete={false}
        closed={false}
        pendingParticipantIds={["person-2"]}
        onRemove={vi.fn()}
        onClose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Gerenciar pessoas"));
    expect(screen.getByRole("button", { name: "Remover Caio" })).toBeDisabled();
  });
});
