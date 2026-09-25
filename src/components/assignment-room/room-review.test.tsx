import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AssignmentBillBreakdown, AssignmentRoomView } from "@/types/assignment-room";
import { RoomBreakdown } from "./room-breakdown";
import { RoomReview, type RoomPayerDraft } from "./room-review";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));

const ROOM_ID = "00000000-0000-4000-8000-000000000001";

function hostView(): Extract<AssignmentRoomView, { role: "host" }> {
  return {
    role: "host",
    groupTarget: { kind: "new", name: "Almoço" },
    participantRefs: [
      { participantId: "host", ref: { kind: "user", userId: "user-host" } },
    ],
    room: {
      id: ROOM_ID,
      revision: 4,
      status: "closed",
      title: "Almoço",
      occurredOn: "2026-09-19",
      serviceFeeBasisPoints: 1_000,
      fixedFeeCents: 2,
      totalCents: 11_002,
      selfParticipantId: "host",
      items: [
        {
          id: "meal",
          ordinal: 0,
          revision: 2,
          description: "Prato feito",
          quantityMilliunits: 1_000,
          unitPriceCents: 10_000,
          totalPriceCents: 10_000,
        },
      ],
      participants: [
        { id: "host", ordinal: 0, displayName: "Ana", avatarUrl: null, isGuest: false, removed: false },
        { id: "guest", ordinal: 1, displayName: "Bia", avatarUrl: null, isGuest: true, removed: false },
      ],
      claims: [{ itemId: "meal", participantId: "host", ticks: 120_000 }],
      topic: null,
      currentBill: null,
    },
  };
}

function currentBill(overrides: Partial<AssignmentBillBreakdown> = {}): AssignmentBillBreakdown {
  return {
    status: "active",
    versionNo: 1,
    title: "Almoço",
    occurredOn: "2026-09-19",
    items: [
      {
        description: "Prato feito",
        quantityMilliunits: 1_000,
        unitPriceCents: 10_000,
        totalPriceCents: 10_000,
      },
    ],
    itemAssignments: [
      { itemIndex: 0, participantIndex: 0, amountCents: 7_000 },
      { itemIndex: 0, participantIndex: 1, amountCents: 3_000 },
    ],
    participants: [
      { participantIndex: 0, displayName: "Ana", avatarUrl: null, isGuest: false },
      { participantIndex: 1, displayName: "Bia", avatarUrl: null, isGuest: true },
    ],
    shares: [7_701, 3_301],
    payers: [{ participantIndex: 0, amountCents: 11_002 }],
    totalCents: 11_002,
    serviceFeeBasisPoints: 1_000,
    fixedFeeCents: 2,
    ...overrides,
  };
}

function ControlledRoomReview({
  onFinalize,
  blockerMessage,
}: {
  onFinalize: () => void;
  blockerMessage?: string;
}) {
  const [payers, setPayers] = useState<RoomPayerDraft[]>([]);
  return (
    <RoomReview
      view={hostView()}
      pending={false}
      blockerMessage={blockerMessage}
      payers={payers}
      onSetPayerFull={(userId) =>
        setPayers([{ userId, amountCents: hostView().room.totalCents }])
      }
      onSplitPaymentEqually={() => undefined}
      onSetPayerAmount={(userId, amountCents) =>
        setPayers((current) => [
          ...current.filter((payer) => payer.userId !== userId),
          { userId, amountCents },
        ])
      }
      onRemovePayerEntry={(userId) =>
        setPayers((current) => current.filter((payer) => payer.userId !== userId))
      }
      onEditClaims={vi.fn()}
      onFinalize={onFinalize}
    />
  );
}

describe("RoomReview", () => {
  it("preselects the eligible host and previews exact fee-inclusive shares", async () => {
    const user = userEvent.setup();
    const onFinalize = vi.fn();
    render(<ControlledRoomReview onFinalize={onFinalize} />);

    const payerSection = screen.getByRole("region", { name: /Quem pagou/ });
    expect(within(payerSection as HTMLElement).getByRole("button", { name: /Ana/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bia$/ })).not.toBeInTheDocument();
    expect(within(payerSection).getByRole("button", { name: /Ana/ })).toHaveTextContent(/R\$\s*110,02/);
    expect(screen.getByRole("button", { name: /^Registrar conta/ })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Bia/ }));
    expect(screen.getByRole("button", { name: /Bia/ })).toHaveTextContent(/R\$\s*0,01/);
    await user.click(screen.getByRole("button", { name: /^Registrar conta/ }));

    expect(onFinalize).toHaveBeenCalledOnce();
  });

  it("names stale blockers and never submits while blocked", async () => {
    const user = userEvent.setup();
    const onFinalize = vi.fn();
    render(
      <ControlledRoomReview
        blockerMessage="A sala mudou. Revise os dados atuais."
        onFinalize={onFinalize}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Registrar conta/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("A sala mudou");
    expect(onFinalize).not.toHaveBeenCalled();
  });

  it("does not restore the default host payment after the host clears it", async () => {
    const user = userEvent.setup();
    const onFinalize = vi.fn();
    render(<ControlledRoomReview onFinalize={onFinalize} />);
    await user.click(screen.getByRole("button", { name: "Mais de uma pessoa pagou" }));
    await user.type(screen.getByRole("textbox", { name: "Valor pago por Ana" }), "50");
    await user.clear(screen.getByRole("textbox", { name: "Valor pago por Ana" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Registrar conta/ }));
    expect(onFinalize).not.toHaveBeenCalled();
  });


});

describe("RoomBreakdown", () => {
  it("keeps an expanded person on current-bill updates and restores focus when removed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <RoomBreakdown bill={currentBill()} selfParticipantIndex={null} />,
    );

    const biaButton = screen.getByRole("button", { name: /Bia/ });
    await user.click(biaButton);
    expect(biaButton).toHaveAttribute("aria-expanded", "true");
    expect(
      within(biaButton.closest("li") as HTMLElement).getByText("Prato feito").parentElement,
    ).toHaveTextContent(/R\$\s*30,00/);

    rerender(
      <RoomBreakdown
        selfParticipantIndex={null}
        bill={currentBill({
          versionNo: 2,
          itemAssignments: [
            { itemIndex: 0, participantIndex: 0, amountCents: 6_000 },
            { itemIndex: 0, participantIndex: 1, amountCents: 4_000 },
          ],
          shares: [6_601, 4_401],
        })}
      />,
    );
    const updatedBia = screen.getByRole("button", { name: /Bia/ });
    expect(updatedBia).toHaveAttribute("aria-expanded", "true");
    expect(
      within(updatedBia.closest("li") as HTMLElement).getByText("Prato feito").parentElement,
    ).toHaveTextContent(/R\$\s*40,00/);

    rerender(
      <RoomBreakdown
        selfParticipantIndex={null}
        bill={currentBill({
          versionNo: 3,
          participants: [{ participantIndex: 0, displayName: "Ana", avatarUrl: null, isGuest: false }],
          itemAssignments: [{ itemIndex: 0, participantIndex: 0, amountCents: 10_000 }],
          shares: [11_002],
        })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Por pessoa" })).toHaveFocus(),
    );
  });

  it("opens the viewer's item amounts by default and allows collapsing them", async () => {
    const user = userEvent.setup();
    render(<RoomBreakdown bill={currentBill()} selfParticipantIndex={1} />);
    const self = screen.getByRole("button", { name: /Você/ });
    expect(self).toHaveAttribute("aria-expanded", "true");
    expect(within(self.closest("li") as HTMLElement).getByText("Prato feito").parentElement).toHaveTextContent(/R\$\s*30,00/);
    expect(screen.getByRole("region", { name: "Sua parte" })).toHaveTextContent(/R\$\s*33,01/);
    await user.click(self);
    expect(self).toHaveAttribute("aria-expanded", "false");
    expect(within(self.closest("li") as HTMLElement).getByText("Prato feito")).not.toBeVisible();
  });

  it("exposes the completion action without embedding room credentials", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <RoomBreakdown
        bill={currentBill()}
        selfParticipantIndex={null}
        actionLabel="Entrar no Dividimos"
        onAction={onAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Entrar no Dividimos" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("sanitizes deleted bills", () => {
    render(
      <RoomBreakdown
        bill={currentBill({ status: "deleted" })}
        selfParticipantIndex={null}
      />,
    );
    const deleted = screen.getByText("Conta excluída").closest("section");
    expect(deleted).toBeInTheDocument();
    expect(within(deleted as HTMLElement).queryByText(/R\$/)).not.toBeInTheDocument();
    expect(screen.queryByText("Prato feito")).not.toBeInTheDocument();
  });
});
