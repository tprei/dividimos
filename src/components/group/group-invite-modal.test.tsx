import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { GroupInviteModal } from "./group-invite-modal";
import {
  createInviteLink,
  deactivateInviteLink,
} from "@/lib/sync/mutations-group";
import {
  isContactPickerSupported,
  pickContacts,
} from "@/lib/contacts";

vi.mock("qrcode", () => ({
  default: {
    toCanvas: vi.fn(),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  createInviteLink: vi.fn(),
  deactivateInviteLink: vi.fn(),
}));

vi.mock("@/lib/contacts", () => ({
  buildWhatsAppLink: vi.fn((text: string) => `https://wa.me?text=${encodeURIComponent(text)}`),
  isContactPickerSupported: vi.fn(() => false),
  pickContacts: vi.fn(),
}));

const groupId = "g1";
const groupName = "Viagem";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
  vi.spyOn(window, "open").mockImplementation(() => null);
});

const readyLink = { groupId, token: "tok123", expiresAt: null, maxUses: null };

/** Opens the modal and loads contacts through the picker, as a user would. */
async function renderWithContacts(contacts: { name: string; phone: string }[]) {
  vi.mocked(createInviteLink).mockResolvedValue(readyLink);
  vi.mocked(isContactPickerSupported).mockReturnValue(true);
  vi.mocked(pickContacts).mockResolvedValue({ status: "ok", contacts });

  render(
    <GroupInviteModal open={true} onClose={vi.fn()} groupId={groupId} groupName={groupName} />,
  );

  await waitFor(() => {
    expect(screen.getByText("Desativar link")).toBeInTheDocument();
  });
  await userEvent.click(screen.getByRole("button", { name: "Escolher dos contatos" }));
  await screen.findByText(contacts[0].name);
}

describe("GroupInviteModal", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <GroupInviteModal
        open={false}
        onClose={vi.fn()}
        groupId={groupId}
        groupName={groupName}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("generates an invite link and draws the QR code on open", async () => {
    const { promise, resolve } = Promise.withResolvers<{
      groupId: string;
      token: string;
      expiresAt: string | null;
      maxUses: number | null;
    }>();

    vi.mocked(createInviteLink).mockReturnValue(promise);

    render(
      <GroupInviteModal
        open={true}
        onClose={vi.fn()}
        groupId={groupId}
        groupName={groupName}
      />,
    );

    expect(screen.getByText("Gerando link...")).toBeInTheDocument();

    resolve({
      groupId,
      token: "tok123",
      expiresAt: null,
      maxUses: null,
    });

    await waitFor(() => {
      expect(createInviteLink).toHaveBeenCalledWith(
        groupId,
        expect.any(String),
        null,
      );
      const [, expiresAt] = vi.mocked(createInviteLink).mock.calls[0];
      expect(Date.parse(expiresAt as string)).toBeGreaterThan(Date.now());
      expect(QRCode.toCanvas).toHaveBeenCalled();
    });

    const canvasArgs = vi.mocked(QRCode.toCanvas).mock.calls[0];
    expect(canvasArgs[1]).toBe(`${window.location.origin}/join/tok123`);
  });

  it("copies the invite link to the clipboard", async () => {
    vi.mocked(createInviteLink).mockResolvedValue({
      groupId,
      token: "tok123",
      expiresAt: null,
      maxUses: null,
    });

    render(
      <GroupInviteModal
        open={true}
        onClose={vi.fn()}
        groupId={groupId}
        groupName={groupName}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Desativar link")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Copiar link" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join/tok123`,
    );
    expect(toast.success).toHaveBeenCalledWith("Link copiado!");
  });

  it("deactivates the link and allows generating a new one", async () => {
    vi.mocked(createInviteLink).mockResolvedValue({
      groupId,
      token: "tok123",
      expiresAt: null,
      maxUses: null,
    });
    vi.mocked(deactivateInviteLink).mockResolvedValue(undefined);

    render(
      <GroupInviteModal
        open={true}
        onClose={vi.fn()}
        groupId={groupId}
        groupName={groupName}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Desativar link")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Desativar link" }));

    await waitFor(() => {
      expect(deactivateInviteLink).toHaveBeenCalledWith(groupId);
      expect(toast.success).toHaveBeenCalledWith("Link desativado");
      expect(screen.getByText("Gerar novo link")).toBeInTheDocument();
    });

    // Clica em gerar novo link
    vi.mocked(createInviteLink).mockResolvedValueOnce({
      groupId,
      token: "tok456",
      expiresAt: null,
      maxUses: null,
    });

    await userEvent.click(screen.getByRole("button", { name: "Gerar novo link" }));

    await waitFor(() => {
      expect(createInviteLink).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Desativar link")).toBeInTheDocument();
    });
  });

  it("shows an error message when link creation fails", async () => {
    vi.mocked(createInviteLink).mockRejectedValueOnce(new Error("network"));

    render(
      <GroupInviteModal
        open={true}
        onClose={vi.fn()}
        groupId={groupId}
        groupName={groupName}
      />,
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
      expect(screen.getByText("Gerar novo link")).toBeInTheDocument();
    });
  });

  it("opens WhatsApp with a formatted message", async () => {
    vi.mocked(createInviteLink).mockResolvedValue({
      groupId,
      token: "tok123",
      expiresAt: null,
      maxUses: null,
    });

    render(
      <GroupInviteModal
        open={true}
        onClose={vi.fn()}
        groupId={groupId}
        groupName={groupName}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Desativar link")).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Enviar pelo WhatsApp" }),
    );

    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining("https://wa.me?text="),
      "_blank",
    );
  });

  it("keeps the contact retryable when the WhatsApp composer is blocked", async () => {
    await renderWithContacts([{ name: "Ana", phone: "+5511999999999" }]);

    // beforeEach stubs window.open to return null, as a popup blocker does.
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível abrir o WhatsApp. Tente novamente.",
    );
    expect(screen.queryByText("Aberto")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });

  it("marks the contact as opened when the composer opens", async () => {
    await renderWithContacts([{ name: "Ana", phone: "+5511999999999" }]);
    vi.mocked(window.open).mockReturnValue({} as Window);

    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(screen.getByText("Aberto")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enviar" }),
    ).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("send-all counts only contacts whose composer opened", async () => {
    await renderWithContacts([
      { name: "Ana", phone: "+5511999999999" },
      { name: "Bruno", phone: "+5522888888888" },
    ]);
    // Ana's popup is blocked, Bruno's opens.
    vi.mocked(window.open)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({} as Window);

    await userEvent.click(
      screen.getByRole("button", { name: "Enviar para todos (2)" }),
    );

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível abrir o WhatsApp. Tente novamente.",
    );
    expect(screen.getByText("Aberto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });
});
