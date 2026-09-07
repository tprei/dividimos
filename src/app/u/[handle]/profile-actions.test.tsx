import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SendMessageButton } from "./profile-actions";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const getOrCreateDmMock = vi.fn();
vi.mock("@/lib/sync/mutations-group", () => ({
  getOrCreateDm: (...args: unknown[]) => getOrCreateDmMock(...args),
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
    getOrCreateDmMock.mockResolvedValue({ groupId: "group-abc", created: true });

    render(
      <SendMessageButton targetUserId="user-123" targetName="João" />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(getOrCreateDmMock).toHaveBeenCalledWith("user-123");
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/app/conversations/user-123");
    });
  });

  it("shows error toast on failure", async () => {
    getOrCreateDmMock.mockRejectedValue(new Error("unauthenticated"));

    render(
      <SendMessageButton targetUserId="user-123" targetName="João" />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("disables the button while loading", async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    getOrCreateDmMock.mockReturnValue(promise);

    render(
      <SendMessageButton targetUserId="user-123" targetName="João" />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeDisabled();
      expect(screen.getByText("Abrindo conversa...")).toBeInTheDocument();
    });

    resolve({ groupId: "group-abc", created: true });
  });
});
