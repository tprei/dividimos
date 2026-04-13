import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SendMessageButton } from "./profile-actions";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const getOrCreateDmGroupMock = vi.fn();
vi.mock("@/lib/supabase/dm-actions", () => ({
  getOrCreateDmGroup: (...args: unknown[]) => getOrCreateDmGroupMock(...args),
}));

vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

describe("SendMessageButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the button with the target name", () => {
    render(
      <SendMessageButton targetUserId="user-123" targetName="João" />,
    );
    expect(
      screen.getByText("Enviar mensagem para João"),
    ).toBeInTheDocument();
  });

  it("creates a DM group and navigates on click", async () => {
    getOrCreateDmGroupMock.mockResolvedValue({ groupId: "group-abc" });

    render(
      <SendMessageButton targetUserId="user-123" targetName="João" />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(getOrCreateDmGroupMock).toHaveBeenCalledWith("user-123");
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/app/conversations/user-123");
    });
  });

  it("shows error toast on failure", async () => {
    getOrCreateDmGroupMock.mockResolvedValue({
      error: "Não autenticado",
      code: "not_authenticated",
    });

    const toast = await import("react-hot-toast");

    render(
      <SendMessageButton targetUserId="user-123" targetName="João" />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(toast.default.error).toHaveBeenCalledWith("Não autenticado");
    });
  });

  it("disables the button while loading", async () => {
    let resolve: (v: unknown) => void;
    getOrCreateDmGroupMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    render(
      <SendMessageButton targetUserId="user-123" targetName="João" />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeDisabled();
      expect(screen.getByText("Abrindo conversa...")).toBeInTheDocument();
    });

    resolve!({ groupId: "group-abc" });
  });
});
