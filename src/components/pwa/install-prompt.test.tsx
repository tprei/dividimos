import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { InstallPrompt } from "./install-prompt";

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

function setStandaloneMode(standalone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn((query: string) => ({
      matches: query === "(display-mode: standalone)" ? standalone : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
    configurable: true,
    writable: true,
  });
}

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IOS_CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("InstallPrompt", () => {
  const originalUA = navigator.userAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    setStandaloneMode(false);
    // Clear any captured prompt from previous tests
    (window as unknown as Record<string, unknown>).__pwaInstallPrompt = null;
  });

  afterEach(() => {
    setUserAgent(originalUA);
  });

  describe("isMobileBrowser detection", () => {
    it("renders nothing on desktop browsers", () => {
      setUserAgent(DESKTOP_UA);
      const { container } = render(<InstallPrompt />);
      expect(container.innerHTML).toBe("");
    });

    it("renders nothing when already in standalone mode", () => {
      setUserAgent(ANDROID_UA);
      setStandaloneMode(true);
      const { container } = render(<InstallPrompt />);
      expect(container.innerHTML).toBe("");
    });

    it("renders install button on Android", () => {
      setUserAgent(ANDROID_UA);
      render(<InstallPrompt />);
      expect(screen.getByLabelText("Instalar no celular")).toBeInTheDocument();
    });
  });

  describe("iOS Safari manual instructions", () => {
    it("renders install button on iOS Safari", () => {
      setUserAgent(IOS_SAFARI_UA);
      render(<InstallPrompt />);
      expect(screen.getByLabelText("Instalar no celular")).toBeInTheDocument();
    });

    it("shows install button on iOS Chrome (not detected as Safari)", () => {
      setUserAgent(IOS_CHROME_UA);
      render(<InstallPrompt />);
      expect(screen.getByLabelText("Instalar no celular")).toBeInTheDocument();
      expect(screen.queryByText("Compartilhar")).not.toBeInTheDocument();
    });
  });

  describe("beforeinstallprompt event", () => {
    it("captures __pwaInstallPrompt from window on mount", async () => {
      setUserAgent(ANDROID_UA);

      const mockPrompt = vi.fn().mockResolvedValue(undefined);
      const mockChoice = Promise.resolve({
        outcome: "accepted" as const,
      });

      (window as unknown as Record<string, unknown>).__pwaInstallPrompt = {
        prompt: mockPrompt,
        userChoice: mockChoice,
        preventDefault: vi.fn(),
      };

      render(<InstallPrompt />);

      // Click install to trigger prompt usage
      fireEvent.click(screen.getByLabelText("Instalar no celular"));
      await act(async () => {
        await mockChoice;
      });

      expect(mockPrompt).toHaveBeenCalledOnce();
      // After accepted, should hide
      expect(screen.queryByLabelText("Instalar no celular")).not.toBeInTheDocument();
    });

    it("captures late beforeinstallprompt events", async () => {
      setUserAgent(ANDROID_UA);

      const mockPrompt = vi.fn().mockResolvedValue(undefined);
      const mockChoice = Promise.resolve({
        outcome: "accepted" as const,
      });

      render(<InstallPrompt />);

      // Fire the event after mount
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, { prompt: mockPrompt, userChoice: mockChoice });
      window.dispatchEvent(event);

      fireEvent.click(screen.getByLabelText("Instalar no celular"));
      await act(async () => {
        await mockChoice;
      });

      expect(mockPrompt).toHaveBeenCalledOnce();
    });

    it("hides prompt when appinstalled event fires", () => {
      setUserAgent(ANDROID_UA);
      render(<InstallPrompt />);
      expect(screen.getByLabelText("Instalar no celular")).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new Event("appinstalled"));
      });

      expect(screen.queryByLabelText("Instalar no celular")).not.toBeInTheDocument();
    });
  });

  describe("install button behavior", () => {
    it("keeps prompt visible when outcome is dismissed", async () => {
      setUserAgent(ANDROID_UA);

      const mockPrompt = vi.fn().mockResolvedValue(undefined);
      const mockChoice = Promise.resolve({
        outcome: "dismissed" as const,
      });

      (window as unknown as Record<string, unknown>).__pwaInstallPrompt = {
        prompt: mockPrompt,
        userChoice: mockChoice,
        preventDefault: vi.fn(),
      };

      render(<InstallPrompt />);

      fireEvent.click(screen.getByLabelText("Instalar no celular"));
      await act(async () => {
        await mockChoice;
      });

      expect(screen.queryByLabelText("Instalar no celular")).toBeInTheDocument();
    });

    it("opens install guide when no native prompt available", async () => {
      setUserAgent(ANDROID_UA);
      render(<InstallPrompt />);

      await act(async () => {
        fireEvent.click(screen.getByLabelText("Instalar no celular"));
      });

      expect(screen.queryByLabelText("Instalar no celular")).toBeInTheDocument();
      expect(screen.getByText("Instalar o app")).toBeInTheDocument();
    });
  });

});
