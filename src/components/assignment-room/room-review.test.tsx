import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AssignmentBillBreakdown, AssignmentRoomView } from "@/types/assignment-room";
import { RoomBreakdown } from "./room-breakdown";
import { RoomReview } from "./room-review";

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

describe("RoomReview", () => {
  it("previews exact shares and fees but requires an explicit eligible payer", async () => {
    const user = userEvent.setup();
    const onFinalize = vi.fn();
    render(
      <RoomReview
        view={hostView()}
        pending={false}
        onEditClaims={vi.fn()}
        onFinalize={onFinalize}
      />,
    );

    expect(screen.getAllByText("Aguardando confirmação").length).toBeGreaterThan(0);
    expect(screen.getByText("Taxa de serviço").parentElement).toHaveTextContent(/R\$\s*10,00/);
    expect(screen.getByText("Taxa fixa").parentElement).toHaveTextContent(/R\$\s*0,02/);
    const payerSection = screen.getByRole("heading", { name: "Quem pagou?" }).closest("section");
    expect(within(payerSection as HTMLElement).getByRole("button", { name: /Ana/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bia$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar conta" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Selecione quem pagou");
    await user.click(screen.getByRole("button", { name: /Bia/ }));
    expect(screen.getByText(/Sem consumo, com a parte da taxa fixa/)).toBeInTheDocument();

    await user.click(within(payerSection as HTMLElement).getByRole("button", { name: /Ana/ }));
    await user.click(screen.getByRole("button", { name: "Registrar conta" }));

    expect(onFinalize).toHaveBeenCalledOnce();
    expect(onFinalize.mock.calls[0][0]).toMatchObject({
      shares: [11_001, 1],
      payers: [{ participantIndex: 0, amountCents: 11_002 }],
      itemAssignments: [{ itemIndex: 0, participantIndex: 0, amountCents: 10_000 }],
    });
  });

  it("names stale blockers and never submits while blocked", async () => {
    const user = userEvent.setup();
    const onFinalize = vi.fn();
    render(
      <RoomReview
        view={hostView()}
        pending={false}
        blockerMessage="A sala mudou. Revise os dados atuais."
        onEditClaims={vi.fn()}
        onFinalize={onFinalize}
      />,
    );

    const payerSection = screen.getByRole("heading", { name: "Quem pagou?" }).closest("section");
    await user.click(within(payerSection as HTMLElement).getByRole("button", { name: /Ana/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("A sala mudou");
    expect(screen.getByRole("button", { name: "Registrar conta" })).toBeDisabled();
    expect(onFinalize).not.toHaveBeenCalled();
  });
});

describe("RoomBreakdown", () => {
  it("keeps an expanded person on current-bill updates and focuses the heading when removed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RoomBreakdown bill={currentBill()} roomId={ROOM_ID} />);

    const biaButton = screen.getByRole("button", { name: /Bia/ });
    await user.click(biaButton);
    expect(biaButton).toHaveAttribute("aria-expanded", "true");
    expect(
      within(biaButton.closest("li") as HTMLElement).getByText("Prato feito").parentElement,
    ).toHaveTextContent(/R\$\s*30,00/);

    rerender(
      <RoomBreakdown
        roomId={ROOM_ID}
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
        roomId={ROOM_ID}
        bill={currentBill({
          versionNo: 3,
          participants: [{ participantIndex: 0, displayName: "Ana", avatarUrl: null, isGuest: false }],
          itemAssignments: [{ itemIndex: 0, participantIndex: 0, amountCents: 10_000 }],
          shares: [11_002],
        })}
      />,
    );
    await waitFor(() => expect(screen.getByText("Por pessoa")).toHaveFocus());
  });

  it("uses a secret-free login destination and sanitizes deleted bills", () => {
    const { rerender } = render(
      <RoomBreakdown bill={currentBill()} roomId={ROOM_ID} showLogin />,
    );
    const login = screen.getByRole("link", { name: "Entrar no Dividimos" });
    expect(login).toHaveAttribute(
      "href",
      `/auth?next=${encodeURIComponent(`/room/${ROOM_ID}`)}`,
    );
    expect(login.getAttribute("href")).not.toContain("#");

    rerender(
      <RoomBreakdown
        bill={currentBill({ status: "deleted" })}
        roomId={ROOM_ID}
      />,
    );
    const deleted = screen.getByText("Conta excluída").closest("section");
    expect(deleted).toBeInTheDocument();
    expect(within(deleted as HTMLElement).queryByText(/R\$/)).not.toBeInTheDocument();
    expect(screen.queryByText("Prato feito")).not.toBeInTheDocument();
  });
});
