import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

const { processReceiptScanMock } = vi.hoisted(() => ({
  processReceiptScanMock: vi.fn(),
}));
vi.mock("@/lib/process-receipt-scan", () => ({
  processReceiptScan: processReceiptScanMock,
}));

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

import { TypeStep } from "./type-step";
import { __resetAiConsentForTests, grantAiConsent, hasAiConsent } from "@/lib/ai-consent";
import { useAppStore } from "@/stores/app-store";
import type { Me } from "@/types/ledger";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

const stopTracks = vi.fn();
function stubCamera(): Mock<() => Promise<MediaStream>> {
  const getUserMedia = vi.fn(() => {
    const stream = new MediaStream();
    Object.defineProperty(stream, "getTracks", { value: () => [{ stop: stopTracks }] });
    Object.defineProperty(stream, "getVideoTracks", { value: () => [{ stop: stopTracks }] });
    Object.defineProperty(stream, "getAudioTracks", { value: () => [] });
    return Promise.resolve(stream);
  });
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return getUserMedia;
}

function makeMe(id: string): Me {
  return {
    id,
    email: `${id}@example.com`,
    handle: id,
    name: id,
    avatarUrl: null,
    isBot: false,
    pixKeyType: "email",
    pixKeyHint: "",
    onboarded: true,
    notificationPreferences: {},
  };
}

function stepElement(accountId: string | null) {
  return (
    <TypeStep
      groupMembers={[]}
      participants={[]}
      occurredOn="2026-09-27"
      accountId={accountId}
      onTypeSelect={vi.fn()}
      onReviewSubmit={vi.fn()}
      onScanShare={vi.fn()}
      onVoiceConfirm={vi.fn()}
      onReviewingChange={vi.fn()}
      onManageParticipants={vi.fn()}
    />
  );
}

function renderStep(accountId: string | null = "user-a") {
  return render(stepElement(accountId));
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  processReceiptScanMock.mockReset();
  useAppStore.setState({ me: makeMe("user-a") });
  stubCamera();
});

afterEach(() => {
  __resetAiConsentForTests();
  useAppStore.setState({ me: null });
});

describe("TypeStep scan consent gate", () => {
  it("runs the scan entry immediately when consent is already granted", async () => {
    grantAiConsent("user-a");
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByText("Escanear nota").closest("button")!);

    expect(screen.getByTestId("receipt-camera-video")).toBeInTheDocument();
    expect(processReceiptScanMock).not.toHaveBeenCalled();
  });

  it("asks for consent before opening the scanner and calls no transport on decline", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByText("Escanear nota").closest("button")!);

    expect(screen.getByText("Usar IA no Dividimos?")).toBeInTheDocument();
    expect(screen.queryByTestId("receipt-camera-video")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continuar sem IA" }));

    expect(screen.queryByText("Usar IA no Dividimos?")).not.toBeInTheDocument();
    expect(screen.queryByTestId("receipt-camera-video")).not.toBeInTheDocument();
    expect(processReceiptScanMock).not.toHaveBeenCalled();
  });

  it("opens the scanner after accepting the consent dialog", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByText("Escanear nota").closest("button")!);
    await user.click(screen.getByRole("button", { name: "Permitir uso de IA" }));

    expect(hasAiConsent("user-a")).toBe(true);
    expect(screen.getByTestId("receipt-camera-video")).toBeInTheDocument();
  });

  it("asks for consent on the ?scan=true deep link before opening the scanner", async () => {
    searchParams = new URLSearchParams([["scan", "true"]]);
    renderStep();

    expect(await screen.findByText("Usar IA no Dividimos?")).toBeInTheDocument();
    expect(screen.queryByTestId("receipt-camera-video")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Permitir uso de IA" }));

    expect(hasAiConsent("user-a")).toBe(true);
    expect(screen.getByTestId("receipt-camera-video")).toBeInTheDocument();
  });

  it("waits for the account before asking on the deep link", async () => {
    useAppStore.setState({ me: null });
    searchParams = new URLSearchParams([["scan", "true"]]);
    const view = renderStep(null);

    expect(screen.queryByText("Usar IA no Dividimos?")).not.toBeInTheDocument();

    useAppStore.setState({ me: makeMe("user-a") });
    view.rerender(stepElement("user-a"));

    expect(await screen.findByText("Usar IA no Dividimos?")).toBeInTheDocument();
  });
});
