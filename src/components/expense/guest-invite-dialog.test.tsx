import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { qrToCanvas } from "@/lib/qr";
import { GuestInviteDialog } from "./guest-invite-dialog";
import { buildClaimUrl } from "@/lib/claim-qr";
import { readClaimToken, writeClaimToken } from "@/lib/claim-token-cache";
import { LedgerError } from "@/lib/sync/errors";
import { createGuestClaimToken, revokeGuestClaimToken } from "@/lib/sync/mutations-group";
import { refreshExpense } from "@/lib/sync/refresh";
import type { GuestParticipant } from "@/types/ledger";

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  createGuestClaimToken: vi.fn(),
  revokeGuestClaimToken: vi.fn(),
}));

vi.mock("@/lib/sync/refresh", () => ({
  refreshExpense: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/qr", () => ({
  qrToCanvas: vi.fn(() => Promise.resolve()),
}));

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

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
  vi.mocked(createGuestClaimToken).mockResolvedValue({
    token: "gst1_newtoken",
    expiresAt: FUTURE,
  });
  vi.mocked(revokeGuestClaimToken).mockResolvedValue(undefined);
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("GuestInviteDialog", () => {
  it("shows no share button when navigator.share is unavailable", () => {
    writeClaimToken(guest.id, "gst1_cachedtoken", FUTURE);
    renderDialog();

    expect(
      screen.queryByRole("button", { name: "Compartilhar" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copiar link" }),
    ).toBeInTheDocument();
    // The credential-bearing URL is never printed on the surface.
    expect(screen.queryByText(/claim#/)).not.toBeInTheDocument();
  });

  it("copies the exact full claim URL without ever printing it", async () => {
    // userEvent.setup() installs its own clipboard stub, so the real spy has
    // to be installed after it.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    writeClaimToken(guest.id, "gst1_cachedtoken", FUTURE);
    renderDialog();

    expect(screen.queryByText(/claim#/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copiar link" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "http://localhost:3000/claim#gst1_cachedtoken",
      );
    });
    expect(toast.success).toHaveBeenCalledWith("Link copiado");
  });

  it("expands the claim QR and encodes the exact claim URL", async () => {
    const user = userEvent.setup();
    writeClaimToken(guest.id, "gst1_cachedtoken", FUTURE);
    renderDialog();

    expect(screen.getByText("Convidar Bruno")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mostrar QR code" }));

    await waitFor(() => {
      expect(qrToCanvas).toHaveBeenCalled();
    });
    const canvasArgs = vi.mocked(qrToCanvas).mock.calls[0];
    expect(canvasArgs[1]).toBe(buildClaimUrl("gst1_cachedtoken"));

    // The code opens in place: the invite actions stay on screen instead of
    // a second sheet covering them.
    expect(screen.getByText("Convidar Bruno")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR code do convite de Bruno" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ocultar QR code" }));
    expect(screen.queryByRole("img", { name: "QR code do convite de Bruno" })).not.toBeInTheDocument();
  });

  it("toasts success after copying and keeps the failure visible when copy is denied", async () => {
    const user = userEvent.setup();
    writeClaimToken(guest.id, "gst1_cachedtoken", FUTURE);
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

  it("does not generate a link on open; generation is an explicit action", async () => {
    renderDialog({ claimLinkGeneration: 0 });

    expect(createGuestClaimToken).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Gerar link" }));

    await waitFor(() => {
      expect(createGuestClaimToken).toHaveBeenCalledWith("guest-1");
    });
    await waitFor(() => {
      expect(refreshExpense).toHaveBeenCalledWith("e1");
    });
    expect(readClaimToken(guest.id)).toBe("gst1_newtoken");
  });

  it("an outside dismiss tap only closes and never revokes the link", async () => {
    writeClaimToken(guest.id, "gst1_cachedtoken", FUTURE);
    const user = userEvent.setup();
    const { props } = renderDialog();

    const backdrop = document.querySelector('[data-slot="dialog-overlay"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as HTMLElement);

    expect(props.onOpenChange).toHaveBeenCalled();
    expect(props.onOpenChange.mock.calls[0]?.[0]).toBe(false);
    expect(revokeGuestClaimToken).not.toHaveBeenCalled();
    expect(createGuestClaimToken).not.toHaveBeenCalled();
  });

  it("replaces the link after confirm and keeps replacing while the guest is unclaimed", async () => {
    const user = userEvent.setup();
    writeClaimToken(guest.id, "gst1_cachedtoken", FUTURE);
    const { rerender, props } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Substituir link" }));
    expect(screen.getByText("Invalidar link atual?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Substituir" }));
    await waitFor(() => {
      expect(createGuestClaimToken).toHaveBeenCalledWith("guest-1");
    });
    await waitFor(() => {
      expect(refreshExpense).toHaveBeenCalledWith("e1");
    });

    rerender(
      <GuestInviteDialog {...props} guest={{ ...guest, claimLinkGeneration: 3 }} />,
    );

    expect(screen.getByRole("button", { name: "Substituir link" })).toBeInTheDocument();
  });

  it("hides the replace action once the guest has been claimed", () => {
    writeClaimToken(guest.id, "gst1_cachedtoken", FUTURE);
    renderDialog({ claimedBy: "user-9" });

    expect(
      screen.queryByRole("button", { name: "Substituir link" }),
    ).not.toBeInTheDocument();
  });

  it("revokes the link and drops it from this device", async () => {
    const user = userEvent.setup();
    writeClaimToken(guest.id, "gst1_cachedtoken", FUTURE);
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Revogar link" }));

    await waitFor(() => {
      expect(revokeGuestClaimToken).toHaveBeenCalledWith("guest-1");
    });
    expect(readClaimToken(guest.id)).toBeNull();
    expect(
      await screen.findByRole("button", { name: "Gerar link" }),
    ).toBeInTheDocument();
  });

  it("ignores an expired cached token and offers to generate another", () => {
    writeClaimToken(guest.id, "gst1_cachedtoken", new Date(Date.now() - 1000).toISOString());
    renderDialog({ claimLinkGeneration: 1 });

    expect(screen.getByRole("button", { name: "Gerar link" })).toBeInTheDocument();
    expect(screen.queryByText(/gst1_cachedtoken/)).not.toBeInTheDocument();
    expect(createGuestClaimToken).not.toHaveBeenCalled();
  });

  it("toasts the ledger error and keeps the dialog when the replacement fails", async () => {
    const user = userEvent.setup();
    vi.mocked(createGuestClaimToken).mockRejectedValue(new LedgerError("guest_not_found"));
    writeClaimToken(guest.id, "gst1_cachedtoken", FUTURE);
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Substituir link" }));
    await user.click(screen.getByRole("button", { name: "Substituir" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Não achamos esse convidado.");
    });
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
  });
});
