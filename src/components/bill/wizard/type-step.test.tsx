import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CURRENT_AI_CONSENT_VERSION } from "@/lib/ai-consent";
import { useAppStore } from "@/stores/app-store";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TypeStep, type TypeStepProps } from "./type-step";
import type * as AiConsentSync from "@/lib/sync/ai-consent";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";

const mockProcessReceiptScan = vi.fn();
const mockGrant = vi.fn();

vi.mock("@/lib/sync/receipt", () => ({
  processReceiptScan: (...args: unknown[]) => mockProcessReceiptScan(...args),
}));

vi.mock("@/lib/sync/ai-consent", async (importOriginal) => {
  const actual = await importOriginal<typeof AiConsentSync>();
  return { ...actual, grantAiConsent: (...args: unknown[]) => mockGrant(...args) };
});

const searchParamsRef = { current: new URLSearchParams() };
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

function makeMe(id: string, granted: boolean) {
  return {
    id,
    handle: id,
    name: id,
    avatarUrl: null,
    isBot: false,
    email: `${id}@example.com`,
    pixKeyType: null,
    pixKeyHint: null,
    onboarded: true,
    notificationPreferences: {},
    aiConsentVersion: granted ? CURRENT_AI_CONSENT_VERSION : null,
    aiConsentGrantedAt: granted ? "2026-01-01T00:00:00.000Z" : null,
  };
}

function seedAiConsent(userId: string, granted: boolean): void {
  useAppStore.getState().reset();
  useAppStore.setState({
    bootstrapStatus: "ready",
    lastBootstrappedAccountId: userId,
    lastBootstrappedGeneration: 0,
    me: makeMe(userId, granted),
  });
}

function makeBaseProps(): TypeStepProps {
  return {
    groupMembers: [],
    participants: [],
    occurredOn: "2026-01-15",
    accountId: "user-1",
    onTypeSelect: vi.fn(),
    onReviewSubmit: vi.fn(),
    onScanShare: vi.fn(),
    onVoiceConfirm: vi.fn(),
    onReviewingChange: vi.fn(),
    onManageParticipants: vi.fn(),
  };
}

function renderTypeStep(search = "") {
  searchParamsRef.current = new URLSearchParams(search);
  return render(<TypeStep {...makeBaseProps()} />);
}

function makeReceiptFile(): File {
  return new File(["fake-image"], "nota.jpg", { type: "image/jpeg" });
}

async function selectGalleryPhoto(container: HTMLElement): Promise<void> {
  const galleryInput = container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await userEvent.upload(galleryInput, makeReceiptFile());
}

beforeEach(() => {
  seedAiConsent("user-1", false);
  vi.stubGlobal("fetch", vi.fn());
  mockProcessReceiptScan.mockReset();
  mockGrant.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TypeStep AI consent", () => {
  it("a scan deep link asks before mounting capture", async () => {
    renderTypeStep("?scan=true");
    await waitFor(() => {
      expect(screen.getByText("Usar IA no Dividimos?")).toBeInTheDocument();
    });

    expect(screen.queryByText("Escolher da galeria")).toBeNull();
    expect(mockProcessReceiptScan).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a scan deep link waits for a ready bootstrap before asking", () => {
    useAppStore.setState({ bootstrapStatus: "loading", lastBootstrappedAccountId: null });
    renderTypeStep("?scan=true");

    expect(screen.queryByText("Usar IA no Dividimos?")).toBeNull();
    expect(screen.getByText("Que tipo de conta?")).toBeInTheDocument();
  });

  it("declining scan leaves manual types usable and uploads nothing", async () => {
    renderTypeStep("?scan=true");
    await waitFor(() => {
      expect(screen.getByText("Usar IA no Dividimos?")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Continuar sem IA" }));

    expect(screen.queryByText("Usar IA no Dividimos?")).toBeNull();
    expect(screen.getByText("Que tipo de conta?")).toBeInTheDocument();
    expect(screen.queryByText("Escolher da galeria")).toBeNull();
    expect(mockProcessReceiptScan).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepting does not upload a pending receipt", async () => {
    renderTypeStep("?scan=true");
    await waitFor(() => {
      expect(screen.getByText("Usar IA no Dividimos?")).toBeInTheDocument();
    });

    mockGrant.mockImplementationOnce(async () => {
      useAppStore.setState({
        me: makeMe("user-1", true),
        aiConsentRevision: useAppStore.getState().aiConsentRevision + 1,
      });
    });
    await userEvent.click(screen.getByRole("button", { name: "Permitir uso de IA" }));

    expect(
      await screen.findByText("Permissão salva. Toque de novo no recurso para continuar."),
    ).toBeInTheDocument();
    expect(mockProcessReceiptScan).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(screen.queryByText("Usar IA no Dividimos?")).toBeNull();
    expect(screen.queryByText("Escolher da galeria")).toBeNull();
  });

  it("revocation cancels a pending scan", async () => {
    seedAiConsent("user-1", true);
    const { container } = renderTypeStep();

    await userEvent.click(screen.getByRole("button", { name: "Escanear nota" }));
    const galleryInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(galleryInput).not.toBeNull();

    await selectGalleryPhoto(container);
    const deferred = Promise.withResolvers<ReceiptOcrResult>();
    mockProcessReceiptScan.mockReturnValueOnce(deferred.promise);
    await userEvent.click(screen.getByRole("button", { name: "Processar" }));
    expect(mockProcessReceiptScan).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      useAppStore.setState({
        me: makeMe("user-1", false),
        aiConsentRevision: useAppStore.getState().aiConsentRevision + 1,
      });
    });

    await act(async () => {
      deferred.resolve({} as ReceiptOcrResult);
    });

    await waitFor(() => {
      expect(screen.queryByText("Escolher da galeria")).toBeNull();
    });
    expect(screen.queryByText("Que tipo de conta?")).toBeInTheDocument();
  });
});
