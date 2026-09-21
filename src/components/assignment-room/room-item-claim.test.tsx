import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RoomItemClaim } from "./room-item-claim";
import type {
  AssignmentRoomClaim,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
} from "@/types/assignment-room";

/** One unit at 1_000 milliunits, so the whole line is 120_000 ticks. */
const singleItem: AssignmentRoomItem = {
  id: "item-1",
  ordinal: 0,
  revision: 1,
  description: "Toast Bacon Egg",
  quantityMilliunits: 1_000,
  unitPriceCents: 690,
  totalPriceCents: 690,
};

const tripleItem: AssignmentRoomItem = {
  ...singleItem,
  description: "Cervejas",
  quantityMilliunits: 3_000,
  unitPriceCents: 1_000,
  totalPriceCents: 3_000,
};

const me: AssignmentRoomParticipant = {
  id: "person-a",
  ordinal: 0,
  displayName: "Ana Sala",
  avatarUrl: null,
  isGuest: false,
  removed: false,
};
const other: AssignmentRoomParticipant = {
  id: "person-b",
  ordinal: 1,
  displayName: "Bia",
  avatarUrl: null,
  isGuest: true,
  removed: false,
};

interface HarnessOptions {
  item?: AssignmentRoomItem;
  initialClaims?: AssignmentRoomClaim[];
  submit?: (participantId: string, ticks: number) => Promise<boolean>;
  error?: { participantId: string; message: string } | null;
}

/**
 * Mirrors the board: the room only changes once a claim is accepted, so a test
 * that never confirms must observe no change at all.
 */
function Harness({
  item = singleItem,
  initialClaims = [],
  submit,
  error = null,
}: HarnessOptions) {
  const [open, setOpen] = useState(true);
  const [claims, setClaims] = useState(initialClaims);
  const capacity = item.quantityMilliunits * 120;
  const claimed = claims.reduce((sum, claim) => sum + claim.ticks, 0);

  return (
    <>
      <p>
        room: {claims.map((c) => `${c.participantId}=${c.ticks}`).join(",") || "vazio"}
      </p>
      <p>disponível: {capacity - claimed}</p>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <RoomItemClaim
        open={open}
        onOpenChange={setOpen}
        getReturnFocus={() => null}
        item={item}
        claims={claims}
        availableTicks={capacity - claimed}
        selfParticipantId={me.id}
        pending={false}
        disabled={false}
        error={error}
        onSubmit={
          submit ??
          (async (participantId, ticks) => {
            setClaims((current) => {
              const rest = current.filter(
                (claim) => claim.participantId !== participantId,
              );
              return ticks === 0
                ? rest
                : [...rest, { itemId: item.id, participantId, ticks }];
            });
            return true;
          })
        }
      />
    </>
  );
}

describe("RoomItemClaim", () => {
  it("changes nothing until the quantity is confirmed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    render(<Harness submit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "1/2" }));
    await user.click(screen.getByRole("button", { name: "Outra quantidade" }));
    await user.click(
      screen.getByRole("button", { name: "Aumentar uma unidade" }),
    );
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Confirmar quantidade" }),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("leaves the other half available after taking half of one item", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "1/2" }));
    expect(
      screen.getByText("Depois de confirmar, restam 1/2 un."),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Confirmar quantidade" }),
    );
    await waitFor(() =>
      expect(screen.getByText("room: person-a=60000")).toBeInTheDocument(),
    );
    expect(screen.getByText("disponível: 60000")).toBeInTheDocument();
  });

  it("submits an exact third rather than a rounded decimal", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    render(<Harness item={tripleItem} submit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "1/3" }));
    expect(screen.getByText("Sua quantidade: 1 un.")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Confirmar quantidade" }),
    );
    expect(onSubmit).toHaveBeenCalledWith("person-a", 120_000);
  });

  it("edits an existing claim as an absolute quantity", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    render(
      <Harness
        initialClaims={[
          { itemId: singleItem.id, participantId: me.id, ticks: 60_000 },
        ]}
        submit={onSubmit}
      />,
    );

    expect(screen.getByText("Sua quantidade: 1/2 un.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Inteiro" }));
    await user.click(
      screen.getByRole("button", { name: "Confirmar quantidade" }),
    );
    expect(onSubmit).toHaveBeenCalledWith("person-a", 120_000);
  });

  it("releases a claim through the same confirmation", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialClaims={[
          { itemId: singleItem.id, participantId: me.id, ticks: 120_000 },
        ]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Remover minha escolha" }),
    );
    expect(screen.getByText("Sua quantidade: 0 un.")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Confirmar quantidade" }),
    );
    await waitFor(() =>
      expect(screen.getByText("room: vazio")).toBeInTheDocument(),
    );
  });

  it("keeps the editor open and refuses a second send while saving", async () => {
    const user = userEvent.setup();
    const deferred = Promise.withResolvers<boolean>();
    const onSubmit = vi.fn(() => deferred.promise);
    render(<Harness submit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "1/2" }));
    const confirm = screen.getByRole("button", { name: "Confirmar quantidade" });
    await user.click(confirm);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Salvando..." })).toBeDisabled(),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);

    deferred.resolve(true);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Confirmar quantidade" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps the draft and shows why a rejected claim failed", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        submit={async () => false}
        error={{ participantId: me.id, message: "Alguém pegou antes." }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "1/3" }));
    await user.click(
      screen.getByRole("button", { name: "Confirmar quantidade" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Alguém pegou antes."),
    );
    expect(screen.getByText("Sua quantidade: 1/3 un.")).toBeInTheDocument();
  });

  it("refuses a draft the room can no longer fit without changing it", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialClaims={[
          { itemId: singleItem.id, participantId: other.id, ticks: 90_000 },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Outra quantidade" }));
    const input = screen.getByRole("textbox", { name: "Quantidade desejada" });
    await user.clear(input);
    await user.type(input, "1");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "não está mais disponível",
    );
    expect(input).toHaveValue("1");
    expect(
      screen.getByRole("button", { name: "Confirmar quantidade" }),
    ).toBeDisabled();
  });

  it("claims for the person using it, with nobody else to pick", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    render(<Harness submit={onSubmit} />);

    // The room used to let a host hand a line to somebody else; every session
    // now edits its own share only, so there is no target to choose.
    expect(screen.queryByRole("combobox", { name: "Pra quem?" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "1/2" }));
    await user.click(
      screen.getByRole("button", { name: "Confirmar quantidade" }),
    );
    expect(onSubmit).toHaveBeenCalledWith(me.id, 60_000);
  });
});
