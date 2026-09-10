import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { GuestInviteDialog } from "./guest-invite-dialog";
import { writeClaimToken } from "@/lib/claim-token-cache";
import { LedgerError } from "@/lib/sync/errors";
import { issueGuestClaimToken } from "@/lib/sync/mutations-group";
import { refreshExpense } from "@/lib/sync/refresh";
import type { GuestParticipant } from "@/types/ledger";

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  issueGuestClaimToken: vi.fn(),
}));

vi.mock("@/lib/sync/refresh", () => ({
  refreshExpense: vi.fn().mockResolvedValue(undefined),
}));

const guest: GuestParticipant = {
  id: "guest-1",
  displayName: "Bruno",
  claimedBy: null,
  claimLinkGeneration: 1,
};

function renderDialog(overrides: Partial<GuestParticipant> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    guest: { ...guest, ...overrides },
    shareCents: 6000,
    expenseTitle: "Jantar",
    expenseId: "e1",
  };
  const view = render(<GuestInviteDialog {...props} />);
  return { ...view, props };
}
function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(refreshExpense).mockResolvedValue(undefined);
  vi.mocked(issueGuestClaimToken).mockResolvedValue("gst1_newtoken");
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("GuestInviteDialog", () => {
  it("shows no share button when navigator.share is unavailable", () => {
    writeClaimToken(guest.id, "gst1_cachedtoken");
    renderDialog();

    expect(
      screen.queryByRole("button", { name: "Compartilhar" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copiar link" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`http://localhost:3000/claim#gst1_cachedtoken`),
    ).toBeInTheDocument();
  });

  it("toasts success after copying and keeps the failure visible when copy is denied", async () => {
    const user = userEvent.setup();
    writeClaimToken(guest.id, "gst1_cachedtoken");
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Copiar link" }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Link copiado");
    });

    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    await user.click(screen.getByRole("button", { name: "Copiar link" }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Não foi possível copiar o link",
      );
    });
  });

  it("issues the first token on open and persists it", async () => {
    renderDialog({ claimLinkGeneration: 0 });

    await waitFor(() => {
      expect(issueGuestClaimToken).toHaveBeenCalledWith("guest-1");
    });
    await waitFor(() => {
      expect(refreshExpense).toHaveBeenCalledWith("e1");
    });
    expect(
      await screen.findByText(/\/claim#gst1_newtoken$/),
    ).toBeInTheDocument();
  });

  it("replaces the link after confirm and hides the action once generation reaches 2", async () => {
    const user = userEvent.setup();
    writeClaimToken(guest.id, "gst1_cachedtoken");
    const { rerender, props } = renderDialog();

    await user.click(
      screen.getByRole("button", { name: "Substituir link" }),
    );
    expect(screen.getByText("Invalidar link atual?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Substituir" }));
    await waitFor(() => {
      expect(issueGuestClaimToken).toHaveBeenCalledWith("guest-1");
    });
    await waitFor(() => {
      expect(refreshExpense).toHaveBeenCalledWith("e1");
    });

    rerender(
      <GuestInviteDialog
        {...props}
        guest={{ ...guest, claimLinkGeneration: 2 }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Substituir link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copiar link" }),
    ).toBeInTheDocument();
  });

  it("toasts the ledger error and keeps the dialog when the replacement fails", async () => {
    const user = userEvent.setup();
    vi.mocked(issueGuestClaimToken).mockRejectedValue(
      new LedgerError("guest_link_replacement_limit"),
    );
    writeClaimToken(guest.id, "gst1_cachedtoken");
    renderDialog();

    await user.click(
      screen.getByRole("button", { name: "Substituir link" }),
    );
    await user.click(screen.getByRole("button", { name: "Substituir" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Este link já foi substituído uma vez.",
      );
    });
    expect(
      screen.getByRole("button", { name: "Copiar link" }),
    ).toBeInTheDocument();
  });
});
