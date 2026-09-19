import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoomItemClaim } from "./room-item-claim";
import type { AssignmentRoomItem } from "@/types/assignment-room";

const item: AssignmentRoomItem = {
  id: "item-1",
  ordinal: 0,
  revision: 1,
  description: "Cerveja",
  quantityMilliunits: 3_000,
  unitPriceCents: 1_000,
  totalPriceCents: 3_000,
};

function renderClaim(overrides: Partial<React.ComponentProps<typeof RoomItemClaim>> = {}) {
  const onSubmit = vi.fn();
  render(
    <RoomItemClaim
      item={item}
      claimedTicks={0}
      availableTicks={360_000}
      pending={false}
      disabled={false}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return onSubmit;
}

describe("RoomItemClaim", () => {
  it("submits exact absolute ticks for fractions, quantity text, and step controls", async () => {
    const user = userEvent.setup();
    const onSubmit = renderClaim();

    await user.click(screen.getByRole("button", { name: "Escolher quantidade" }));
    await user.click(screen.getByRole("button", { name: "1/3" }));
    expect(onSubmit).toHaveBeenLastCalledWith(120_000);

    onSubmit.mockClear();
    await user.click(screen.getByRole("button", { name: "Aumentar uma unidade" }));
    expect(onSubmit).toHaveBeenCalledWith(120_000);

    const input = screen.getByRole("textbox", { name: "Quantidade desejada" });
    await user.clear(input);
    await user.type(input, "1,5{Enter}");
    expect(onSubmit).toHaveBeenLastCalledWith(180_000);
  });

  it("keeps invalid text local and collapse discards only the draft", async () => {
    const user = userEvent.setup();
    const onSubmit = renderClaim({ claimedTicks: 120_000, availableTicks: 240_000 });

    await user.click(screen.getByRole("button", { name: "Editar minha parte" }));
    const input = screen.getByRole("textbox", { name: "Quantidade desejada" });
    await user.clear(input);
    await user.type(input, "4{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("não está mais disponível");

    await user.click(screen.getByRole("button", { name: "Recolher" }));
    expect(screen.getByText("1/3 do item")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editar minha parte" }));
    expect(screen.getByRole("textbox", { name: "Quantidade desejada" })).toHaveValue("1");
  });

  it("keeps pending feedback visible after the editor collapses", async () => {
    const user = userEvent.setup();
    renderClaim({ pending: true, claimedTicks: 120_000, availableTicks: 240_000 });

    await user.click(screen.getByRole("button", { name: "Editar minha parte" }));
    await user.click(screen.getByRole("button", { name: "Recolher" }));

    expect(screen.getByRole("status")).toHaveTextContent("Salvando sua escolha");
  });
});
