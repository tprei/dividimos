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

/** More than six units, so the sheet offers the stepper instead of buttons. */
const stepperItem: AssignmentRoomItem = {
  ...singleItem,
  description: "Cervejas",
  quantityMilliunits: 8_000,
  unitPriceCents: 1_000,
  totalPriceCents: 8_000,
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
  submit?: (
    participantId: string,
    ticks: number,
    expectedItemRevision: number,
  ) => Promise<boolean>;
  error?: { participantId: string; message: string } | null;
  canSelectParticipant?: boolean;
  onTargetChange?: (participantId: string) => void;
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
  canSelectParticipant = false,
  onTargetChange = () => undefined,
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
        selfParticipantId={me.id}
        item={item}
        claims={claims}
        availableTicks={capacity - claimed}
        targetParticipantId={me.id}
        participants={[me, other]}
        pending={false}
        disabled={false}
        error={error}
        canSelectParticipant={canSelectParticipant}
        onTargetChange={onTargetChange}
        previewCents={(_participantId, ticks) =>
          Math.round((item.totalPriceCents * ticks) / capacity)
        }
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
    render(<Harness item={stepperItem} submit={onSubmit} />);

    await user.click(
      screen.getByRole("button", { name: "Aumentar uma unidade" }),
    );
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Peguei / }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("person-a", 240_000, 1);
  });

  it("leaves the other half available after taking half of one item", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Metade" }));
    expect(
      screen.getByRole("button", { name: "Metade" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /^Peguei / }));
    await waitFor(() =>
      expect(screen.getByText("room: person-a=60000")).toBeInTheDocument(),
    );
    expect(screen.getByText("disponível: 60000")).toBeInTheDocument();
  });

  it("submits an exact third rather than a rounded decimal", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    render(<Harness submit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "⅓" }));
    expect(
      screen.getByRole("button", { name: "⅓" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /^Peguei / }));
    expect(onSubmit).toHaveBeenCalledWith("person-a", 40_000, 1);
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

    expect(
      screen.getByRole("button", { name: "Metade" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Inteira" }));
    await user.click(screen.getByRole("button", { name: /^Peguei / }));
    expect(onSubmit).toHaveBeenCalledWith("person-a", 120_000, 1);
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
    await user.click(screen.getByRole("button", { name: /^Tirar · libera/ }));
    await waitFor(() =>
      expect(screen.getByText("room: vazio")).toBeInTheDocument(),
    );
  });

  it("keeps the editor open and refuses a second send while saving", async () => {
    const user = userEvent.setup();
    const deferred = Promise.withResolvers<boolean>();
    const onSubmit = vi.fn(() => deferred.promise);
    render(<Harness submit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Metade" }));
    await user.click(screen.getByRole("button", { name: /^Peguei / }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Salvando..." })).toBeDisabled(),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);

    deferred.resolve(true);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Salvando..." }),
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

    await user.click(screen.getByRole("button", { name: "⅓" }));
    await user.click(screen.getByRole("button", { name: /^Peguei / }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Alguém pegou antes."),
    );
    expect(
      screen.getByRole("button", { name: "⅓" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("never offers a claim the room can no longer fit", () => {
    const onSubmit = vi.fn(async () => true);
    render(
      <Harness
        initialClaims={[
          { itemId: singleItem.id, participantId: other.id, ticks: 90_000 },
        ]}
        submit={onSubmit}
      />,
    );

    // Only a quarter is left, so larger portions are not offered at all and
    // nothing can be sent before choosing one.
    expect(screen.queryByRole("button", { name: "Inteira" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Metade" })).toBeNull();
    expect(screen.queryByRole("button", { name: "⅓" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Escolha uma quantidade" }),
    ).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks a stale draft until the room is refreshed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    const { rerender } = render(<Harness submit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Metade" }));
    rerender(<Harness item={{ ...singleItem, revision: 2 }} submit={onSubmit} />);

    expect(screen.getByText("A sala mudou.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Peguei / })).toBeDisabled();
    // A stale sheet ignores new picks instead of silently moving the draft.
    await user.click(screen.getByRole("button", { name: "Inteira" }));
    expect(
      screen.getByRole("button", { name: "Metade" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(screen.queryByText("A sala mudou.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Metade" }));
    await user.click(screen.getByRole("button", { name: /^Peguei / }));
    expect(onSubmit).toHaveBeenCalledWith("person-a", 60_000, 2);
  });

  it("claims for the person using it, with nobody else to pick", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => true);
    render(<Harness submit={onSubmit} />);

    // Participant mode is pinned to the signed-in room member; only hosts
    // receive the target picker.
    expect(screen.queryByRole("radiogroup", { name: "Pra quem?" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Metade" }));
    await user.click(screen.getByRole("button", { name: /^Peguei / }));
    expect(onSubmit).toHaveBeenCalledWith(me.id, 60_000, 1);
  });

  it("lets the host choose which active participant owns the draft", async () => {
    const user = userEvent.setup();
    const onTargetChange = vi.fn();
    render(<Harness canSelectParticipant onTargetChange={onTargetChange} />);

    await user.click(screen.getByRole("radio", { name: /Bia/ }));

    expect(onTargetChange).toHaveBeenCalledWith(other.id);
  });

  it("keeps an unconfirmed choice when dismissal is declined", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const onSubmit = vi.fn(async () => true);
    render(<Harness submit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Metade" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Metade" })).toHaveAttribute("aria-pressed", "true");
    expect(onSubmit).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
