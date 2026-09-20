import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoomHostControls } from "./room-host-controls";
import { RoomJoin } from "./room-join";
import { RoomShare } from "./room-share";

const { toCanvas } = vi.hoisted(() => ({ toCanvas: vi.fn() }));
vi.mock("qrcode", () => ({ default: { toCanvas } }));

const participants = [
  { id: "person-a", ordinal: 0, displayName: "Bia", avatarUrl: null, isGuest: true, removed: false },
];

describe("assignment room controls", () => {
  it("validates and trims the no-login display name", async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    render(<RoomJoin pending={false} onJoin={onJoin} />);

    await user.click(screen.getByRole("button", { name: "Entrar na sala" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Digite um nome");

    await user.type(screen.getByLabelText("Seu nome"), "  Bia  ");
    await user.click(screen.getByRole("button", { name: "Entrar na sala" }));
    expect(onJoin).toHaveBeenCalledWith("Bia");
  });

  it("renders the current QR inline and returns focus when collapsed", async () => {
    const user = userEvent.setup();
    render(<RoomShare url="https://dividimos.test/room/room-id#secret" rotating={false} onRotate={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Mostrar convite" });
    await user.click(trigger);
    await waitFor(() => expect(toCanvas).toHaveBeenCalled());
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Recolher convite" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mostrar convite" })).toHaveFocus(),
    );
  });

  it("confirms claim release before removing a participant", async () => {
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

    expect(screen.getByRole("button", { name: "Fechar escolhas" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remover Bia" }));
    expect(screen.getByText(/escolhas dessa pessoa serão liberadas/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remover e liberar itens" }));
    expect(onRemove).toHaveBeenCalledWith("person-a");
  });
});
