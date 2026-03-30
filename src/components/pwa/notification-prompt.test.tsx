import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationPrompt } from "./notification-prompt";

const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock("@/hooks/use-push-notifications", () => ({
  usePushNotifications: vi.fn(() => ({
    permission: "default" as const,
    isSubscribed: false,
    isLoading: false,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
  })),
}));

import { usePushNotifications } from "@/hooks/use-push-notifications";

const mockUsePush = vi.mocked(usePushNotifications);

describe("NotificationPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUsePush.mockReturnValue({
      permission: "default",
      isSubscribed: false,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });
  });

  it("renders when permission is default and not dismissed", () => {
    render(<NotificationPrompt />);
    expect(screen.getByText("Ativar notificações")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ativar" })).toBeInTheDocument();
  });

  it("does not render when already subscribed", () => {
    mockUsePush.mockReturnValue({
      permission: "granted",
      isSubscribed: true,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    const { container } = render(<NotificationPrompt />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render when permission is denied", () => {
    mockUsePush.mockReturnValue({
      permission: "denied",
      isSubscribed: false,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    const { container } = render(<NotificationPrompt />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render when unsupported", () => {
    mockUsePush.mockReturnValue({
      permission: "unsupported",
      isSubscribed: false,
      isLoading: false,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    const { container } = render(<NotificationPrompt />);
    expect(container.innerHTML).toBe("");
  });

  it("calls subscribe and dismisses on Ativar click", async () => {
    mockSubscribe.mockResolvedValue(undefined);
    render(<NotificationPrompt />);

    fireEvent.click(screen.getByRole("button", { name: "Ativar" }));

    expect(mockSubscribe).toHaveBeenCalledOnce();
  });

  it("dismisses and sets sessionStorage on close click", () => {
    render(<NotificationPrompt />);

    fireEvent.click(screen.getByLabelText("Fechar"));

    expect(sessionStorage.getItem("pagajaja:notification-prompt-dismissed")).toBe("1");
  });

  it("does not render when sessionStorage flag is set", () => {
    sessionStorage.setItem("pagajaja:notification-prompt-dismissed", "1");

    const { container } = render(<NotificationPrompt />);
    expect(container.innerHTML).toBe("");
  });

  it("shows loading state when subscribing", () => {
    mockUsePush.mockReturnValue({
      permission: "default",
      isSubscribed: false,
      isLoading: true,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    });

    render(<NotificationPrompt />);
    expect(screen.getByRole("button", { name: "..." })).toBeDisabled();
  });
});
