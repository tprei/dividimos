import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import toast from "react-hot-toast";

const { decodeHolder, mocks } = vi.hoisted(() => ({
  decodeHolder: { payload: "" },
  mocks: {
    push: vi.fn(),
    joinViaLink: vi.fn(),
    lookupUserByHandle: vi.fn(),
    getOrCreateDm: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/components/bill/qr-scanner-view", () => ({
  QrScannerView: ({ onDecode, collapsed, onExpand }: { onDecode: (data: string) => void; collapsed?: boolean; onExpand?: () => void }) => (
    <div data-testid="scanner" data-collapsed={String(Boolean(collapsed))}>
      <button
        type="button"
        aria-label="decodificar"
        onClick={() => onDecode(decodeHolder.payload)}
      />
      {collapsed && <button type="button" onClick={onExpand}>Mostrar câmera</button>}
    </div>
  ),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  joinViaLink: mocks.joinViaLink,
  lookupUserByHandle: mocks.lookupUserByHandle,
  getOrCreateDm: mocks.getOrCreateDm,
}));

import ScanInvitePage from "./page";
import { LedgerError } from "@/lib/sync/errors";

const PROD = "https://www.dividimos.ai";
const TOKEN = "a".repeat(32);
const ROOM_ID = "00000000-0000-4000-8000-000000000001";
const ROOM_TOKEN = `armj1_${"A".repeat(43)}`;

async function decode(payload: string) {
  decodeHolder.payload = payload;
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "decodificar" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  decodeHolder.payload = "";
});

describe("ScanInvitePage router", () => {
  it("opens a pasted invitation without a camera and rejects unrelated text", async () => {
    const user = userEvent.setup();
    mocks.joinViaLink.mockResolvedValueOnce({ groupId: "g-manual", ledgerVersion: 1, eventId: 1 });
    render(<ScanInvitePage />);
    const field = screen.getByLabelText("Link ou código");
    await user.type(field, "texto qualquer");
    await user.click(screen.getByRole("button", { name: "Abrir convite" }));
    expect(screen.getByRole("status")).toHaveTextContent("Esse código não é um convite do Dividimos.");
    expect(mocks.push).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, TOKEN);
    await user.click(screen.getByRole("button", { name: "Abrir convite" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/app/groups/g-manual"));
  });

  it("folds the camera away while a code is typed and brings it back after", async () => {
    const user = userEvent.setup();
    render(<ScanInvitePage />);
    const scanner = screen.getByTestId("scanner");
    const field = screen.getByLabelText("Link ou código");

    await user.click(field);
    expect(scanner).toHaveAttribute("data-collapsed", "true");
    await user.type(field, "abc");
    await user.pointer({ keys: "[MouseLeft>]", target: screen.getByRole("button", { name: "Abrir convite" }) });
    expect(field).toHaveFocus();
    expect(scanner).toHaveAttribute("data-collapsed", "true");
    await user.pointer({ keys: "[/MouseLeft]" });

    await user.click(screen.getByRole("button", { name: "Mostrar câmera" }));
    expect(scanner).toHaveAttribute("data-collapsed", "false");
    expect(field).not.toHaveFocus();

    await user.click(field);
    await user.tab();
    await user.tab();
    expect(scanner).toHaveAttribute("data-collapsed", "false");
  });

  it("joins the group and navigates to it when a group invite is scanned", async () => {
    mocks.joinViaLink.mockResolvedValueOnce({ groupId: "g-42", ledgerVersion: 3, eventId: 9 });
    render(<ScanInvitePage />);

    await decode(`${PROD}/join/${TOKEN}`);

    await waitFor(() => {
      expect(mocks.joinViaLink).toHaveBeenCalledWith(TOKEN);
    });
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/app/groups/g-42");
    });
  });

  it("opens an assignment room without attempting a group join", async () => {
    render(<ScanInvitePage />);

    await decode(`${PROD}/room/${ROOM_ID}#${ROOM_TOKEN}`);

    expect(mocks.push).toHaveBeenCalledWith(`/room/${ROOM_ID}#${ROOM_TOKEN}`);
    expect(mocks.joinViaLink).not.toHaveBeenCalled();
  });

  it("shows the invalid-invite hint and resumes scanning when the link is dead", async () => {
    mocks.joinViaLink.mockRejectedValueOnce(new LedgerError("invalid_link"));
    render(<ScanInvitePage />);

    await decode(`${PROD}/join/${TOKEN}`);

    expect(await screen.findByText("Esse convite não é mais válido.")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Esse convite não é mais válido.");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("renders the profile action sheet and creates nothing until a tap", async () => {
    mocks.lookupUserByHandle.mockResolvedValueOnce({
      id: "user-7",
      handle: "fulano",
      name: "Fulano Silva",
      avatarUrl: null,
      isBot: false,
    });
    mocks.getOrCreateDm.mockResolvedValueOnce({ groupId: "g-99", created: true });
    render(<ScanInvitePage />);

    await decode(`${PROD}/u/fulano`);

    expect(await screen.findByText("Fulano Silva")).toBeInTheDocument();
    expect(screen.getByText("@fulano")).toBeInTheDocument();
    expect(mocks.getOrCreateDm).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Dividir uma conta" }));

    await waitFor(() => {
      expect(mocks.getOrCreateDm).toHaveBeenCalledWith("user-7");
    });
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/app/bill/new?dm=user-7&groupId=g-99&type=single_amount");
    });
  });

  it("toasts when the scanned handle does not resolve", async () => {
    mocks.lookupUserByHandle.mockResolvedValueOnce(null);
    render(<ScanInvitePage />);

    await decode(`${PROD}/u/fulano`);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Não achamos esse perfil.");
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
