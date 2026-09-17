import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "./empty-state";
import { Receipt } from "lucide-react";

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(
      <EmptyState
        icon={Receipt}
        title="Nenhuma conta"
        description="Crie sua primeira conta para comecar."
      />,
    );

    expect(screen.getByText("Nenhuma conta")).toBeInTheDocument();
    expect(screen.getByText("Crie sua primeira conta para comecar.")).toBeInTheDocument();
  });

  it("renders action button when provided", () => {
    render(
      <EmptyState
        icon={Receipt}
        title="Vazio"
        description="Nada aqui"
        actionLabel="Nova conta"
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Nova conta")).toBeInTheDocument();
  });

  it("does not render action button when label missing", () => {
    render(
      <EmptyState icon={Receipt} title="Vazio" description="Nada aqui" />,
    );

    // No base-ui buttons should be rendered
    const buttons = screen.queryAllByRole("button");
    expect(buttons).toHaveLength(0);
  });

  it("calls onAction when button clicked", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        icon={Receipt}
        title="Vazio"
        description="Nada"
        actionLabel="Criar"
        onAction={onAction}
      />,
    );

    const btn = screen.getByText("Criar").closest("button")!;
    await user.click(btn);
    expect(onAction).toHaveBeenCalledOnce();
  });
});
