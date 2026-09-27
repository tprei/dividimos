import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteAccountDialog, type DeleteAccountDialogState } from "./delete-account-dialog";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string; "aria-label"?: string; className?: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const base = {
  open: true,
  confirmed: false,
  onConfirmedChange: vi.fn(),
  onClose: vi.fn(),
  onConfirm: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DeleteAccountDialog", () => {
  it("requires the explicit checkbox before enabling the destructive action", () => {
    render(<DeleteAccountDialog {...base} state={{ status: "idle" }} />);

    const confirm = screen.getByRole("button", { name: "Excluir minha conta do Dividimos" });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(base.onConfirmedChange).toHaveBeenCalledWith(true);
  });

  it("keeps dismissal available while idle and renders the consequences copy", () => {
    render(<DeleteAccountDialog {...base} state={{ status: "idle" }} />);

    expect(screen.getByText("Essa ação não pode ser desfeita.")).toBeDefined();
    expect(
      screen.getByText("Se entrar de novo com o mesmo Google, você cria uma nova conta."),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(base.onClose).toHaveBeenCalled();
  });

  it("blocks submissions and dismissal while loading", () => {
    render(
      <DeleteAccountDialog
        {...base}
        confirmed
        state={{ status: "loading" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Excluindo sua conta…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(base.onClose).not.toHaveBeenCalled();
  });

  it("renders refusal groups as links using the returned ids", () => {
    render(
      <DeleteAccountDialog
        {...base}
        state={{
          status: "blocked",
          groups: [{ id: "g-1", name: "Grupo devendo" }],
        }}
      />,
    );

    const link = screen.getByRole("link", { name: "Abrir grupo Grupo devendo" });
    expect(link.getAttribute("href")).toBe("/app/groups/g-1");
    expect(screen.getByText("Já acertei os saldos, tentar de novo")).toBeDefined();
  });

  it("offers no undo after the deletion committed", () => {
    const state: DeleteAccountDialogState = {
      status: "error",
      committed: true,
      message: "Seus dados já foram apagados ou anonimizados. Falta encerrar o acesso. Tente novamente.",
    };
    render(<DeleteAccountDialog {...base} state={state} />);

    expect(screen.getByText(/Seus dados já foram apagados ou anonimizados/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeDefined();
  });

  it("shows the success state", () => {
    render(<DeleteAccountDialog {...base} state={{ status: "success" }} />);
    expect(screen.getByText("Sua conta do Dividimos foi excluída.")).toBeDefined();
  });
});
