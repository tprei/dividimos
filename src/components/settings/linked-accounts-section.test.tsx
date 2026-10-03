import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkedAccountsSection } from "./linked-accounts-section";

const base = { providers: { apple: false, google: false }, loadFailed: false, onRetryLoad: vi.fn(), linkable: { apple: true, google: true }, pendingProvider: null, error: null, onLink: vi.fn(), onDismissError: vi.fn() };

describe("LinkedAccountsSection", () => {
  it("offers no connect action for a provider this build cannot link", () => {
    render(<LinkedAccountsSection {...base} linkable={{ apple: true, google: false }} />);
    expect(screen.getByRole("button", { name: "Conectar conta Apple" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conectar conta Google" })).not.toBeInTheDocument();
    expect(screen.getByText("Indisponível")).toBeInTheDocument();
  });

  it("sends the chosen provider and offers no action for an already linked account", () => {
    const onLink = vi.fn();
    render(<LinkedAccountsSection {...base} providers={{ apple: true, google: false }} onLink={onLink} />);
    expect(screen.queryByRole("button", { name: "Conectar conta Apple" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conectar conta Google" }));
    expect(onLink).toHaveBeenCalledWith("google");
  });

  it("blocks both provider actions during a link and announces which one is busy", () => {
    const onLink = vi.fn();
    render(<LinkedAccountsSection {...base} pendingProvider="apple" onLink={onLink} />);
    const apple = screen.getByRole("button", { name: "Conectando Apple" });
    const google = screen.getByRole("button", { name: "Conectar conta Google" });
    expect(apple).toHaveAttribute("aria-busy", "true");
    expect(apple).toBeDisabled();
    expect(google).toBeDisabled();
    fireEvent.click(google);
    expect(onLink).not.toHaveBeenCalled();
  });

  it("exposes loading without offering a premature connect action", () => {
    render(<LinkedAccountsSection {...base} providers={null} />);
    expect(screen.getByRole("status", { name: "Carregando contas conectadas" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps an error dismissible while providers are loading", () => {
    const onDismissError = vi.fn();
    render(<LinkedAccountsSection {...base} providers={null} error="Falha na conexão" onDismissError={onDismissError} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Falha na conexão");
    fireEvent.click(screen.getByRole("button", { name: "Dispensar aviso de conexão" }));
    expect(onDismissError).toHaveBeenCalledOnce();
  });

  it("replaces the loading rows with a retry when providers fail to load", () => {
    const onRetryLoad = vi.fn();
    render(<LinkedAccountsSection {...base} providers={null} loadFailed onRetryLoad={onRetryLoad} />);
    expect(screen.queryByRole("status", { name: "Carregando contas conectadas" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Não deu para carregar as contas conectadas.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetryLoad).toHaveBeenCalledOnce();
  });
});
