import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NfceQrResult } from "@/lib/nfce-qr";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import { TypeStep } from "./type-step";

const { fetchSefazReceipt, processReceiptScan, latestQrDetected } = vi.hoisted(() => ({
  fetchSefazReceipt: vi.fn(),
  processReceiptScan: vi.fn(),
  latestQrDetected: { current: null as ((result: NfceQrResult) => Promise<void>) | null },
}));

vi.mock("@/lib/process-receipt-scan", () => ({
  fetchSefazReceipt,
  processReceiptScan,
  SefazFallbackError: class SefazFallbackError extends Error {},
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/app/bill/new",
}));

const ACCESS_KEY = "35240199999999999999550010000001231234567890";

type ScannerProps = {
  onProcess: (file: File) => Promise<void>;
  onQrDetected: (result: NfceQrResult) => Promise<void>;
  onBack: () => void;
  processing: boolean;
};

vi.mock("@/components/bill/receipt-scanner", () => ({
  ReceiptScanner: ({ onProcess, onQrDetected, onBack }: ScannerProps) => {
    latestQrDetected.current = onQrDetected;
    return (
      <div>
      <button
        type="button"
        onClick={() =>
          void onQrDetected({
            chaveAcesso: ACCESS_KEY,
            url: "https://nfce.sefaz.example/?chNFe=" + ACCESS_KEY,
          })
        }
      >
        Simular QR
      </button>
      <button
        type="button"
        onClick={() =>
          void onProcess(new File(["fake"], "nota.jpg", { type: "image/jpeg" }))
        }
      >
        Simular Foto
      </button>
      <button type="button" onClick={onBack}>
        Voltar scanner
      </button>
      </div>
    );
  },
}));

const receipt: ReceiptOcrResult = {
  merchant: "Bar do Zé",
  items: [
    {
      description: "Cerveja",
      quantity: 1,
      unitPriceCents: 1200,
      totalCents: 1200,
    },
  ],
  serviceFeeBasisPoints: 0,
  fixedFeesCents: 0,
  totalCents: 1200,
};

const photoReceipt: ReceiptOcrResult = {
  ...receipt,
  merchant: "Foto do Restaurante",
};

const onTypeSelect = vi.fn();
const onVoiceConfirm = vi.fn();

function renderTypeStep(accountId = "account-1") {
  const onScanConfirm = vi.fn();
  render(
    <TypeStep
      groupMembers={[]}
      accountId={accountId}
      participants={[]}
      occurredOn="2026-09-10"
      onTypeSelect={onTypeSelect}
      onScanConfirm={onScanConfirm}
      onVoiceConfirm={onVoiceConfirm}
      onReviewingChange={() => {}}
    />,
  );
  return onScanConfirm;
}

async function openScanner(user: UserEvent) {
  const scanButton = screen.getByText("Escanear nota").closest("button");
  if (!scanButton) throw new Error("scan button not found");
  await user.click(scanButton);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TypeStep scan attempt lifecycle", () => {
  it("confirms a reviewed QR receipt together with its access key", async () => {
    const user = userEvent.setup();
    fetchSefazReceipt.mockResolvedValueOnce(receipt);
    const onScanConfirm = renderTypeStep();


    await openScanner(user);
    await user.click(screen.getByRole("button", { name: "Simular QR" }));
    await user.click(await screen.findByRole("button", { name: /Continuar para divisão/ }));

    expect(fetchSefazReceipt).toHaveBeenCalledWith(
      "https://nfce.sefaz.example/?chNFe=" + ACCESS_KEY,
      ACCESS_KEY,
      expect.any(AbortSignal),
    );
    expect(onScanConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: "Bar do Zé" }),
      ACCESS_KEY,
      expect.anything(),
      expect.any(String),
    );
  });

  it("yields a null key when a QR review is cancelled and a photo receipt is confirmed", async () => {
    const user = userEvent.setup();
    fetchSefazReceipt.mockResolvedValueOnce(receipt);
    processReceiptScan.mockResolvedValueOnce(photoReceipt);
    const onScanConfirm = renderTypeStep();

    await openScanner(user);
    await user.click(screen.getByRole("button", { name: "Simular QR" }));
    await user.click(await screen.findByRole("button", { name: "Voltar" }));

    // Back at the type selector; a fresh photo scan must not inherit the QR key.
    await openScanner(user);
    await user.click(screen.getByRole("button", { name: "Simular Foto" }));
    await user.click(await screen.findByRole("button", { name: /Continuar para divisão/ }));

    expect(onScanConfirm).toHaveBeenCalledTimes(1);
    expect(onScanConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: "Foto do Restaurante" }),
      null,
      expect.anything(),
      expect.any(String),
    );
    expect(onScanConfirm).not.toHaveBeenCalledWith(
      expect.objectContaining({ merchant: "Bar do Zé" }),
      ACCESS_KEY,
    );
  });

  it("aborts an in-flight QR fetch and ignores its result when the user goes back", async () => {
    const user = userEvent.setup();
    let resolveFetch!: (r: ReceiptOcrResult) => void;
    fetchSefazReceipt.mockReturnValueOnce(
      new Promise<ReceiptOcrResult>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const onScanConfirm = renderTypeStep();

    await openScanner(user);
    await user.click(screen.getByRole("button", { name: "Simular QR" }));
    await user.click(screen.getByRole("button", { name: "Voltar scanner" }));

    const signal = fetchSefazReceipt.mock.calls[0][2] as AbortSignal;
    expect(signal.aborted).toBe(true);

    resolveFetch(receipt);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Continuar para divisão/ })).not.toBeInTheDocument();
    });
    expect(onScanConfirm).not.toHaveBeenCalled();
  });

  it("aborts pending work and blocks stale results when the account changes", async () => {
    const user = userEvent.setup();
    let resolveFetch!: (r: ReceiptOcrResult) => void;
    fetchSefazReceipt.mockReturnValueOnce(
      new Promise<ReceiptOcrResult>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const onScanConfirm = vi.fn();
    const { rerender } = render(
      <TypeStep
        groupMembers={[]}
        accountId="account-1"
        participants={[]}
        occurredOn="2026-09-10"
        onReviewingChange={() => {}}
        onTypeSelect={onTypeSelect}
        onScanConfirm={onScanConfirm}
        onVoiceConfirm={onVoiceConfirm}
      />,
    );

    await openScanner(user);
    await user.click(screen.getByRole("button", { name: "Simular QR" }));

    rerender(
      <TypeStep
        groupMembers={[]}
        accountId="account-2"
        participants={[]}
        occurredOn="2026-09-10"
        onReviewingChange={() => {}}
        onTypeSelect={onTypeSelect}
        onScanConfirm={onScanConfirm}
        onVoiceConfirm={onVoiceConfirm}
      />,
    );

    const signal = fetchSefazReceipt.mock.calls[0][2] as AbortSignal;
    expect(signal.aborted).toBe(true);

    resolveFetch(receipt);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Continuar para divisão/ })).not.toBeInTheDocument();
    });
    expect(onScanConfirm).not.toHaveBeenCalled();
  });

  it("ignores a stale QR callback delivered after an A-to-B-to-A account round trip", async () => {
    const user = userEvent.setup();
    let resolveFetch!: (r: ReceiptOcrResult) => void;
    fetchSefazReceipt.mockReturnValueOnce(
      new Promise<ReceiptOcrResult>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const onScanConfirm = vi.fn();
    const { rerender } = render(
      <TypeStep
        groupMembers={[]}
        accountId="account-1"
        participants={[]}
        occurredOn="2026-09-10"
        onReviewingChange={() => {}}
        onTypeSelect={onTypeSelect}
        onScanConfirm={onScanConfirm}
        onVoiceConfirm={onVoiceConfirm}
      />,
    );

    await openScanner(user);
    await user.click(screen.getByRole("button", { name: "Simular QR" }));
    const staleQrDetected = latestQrDetected.current;
    if (!staleQrDetected) throw new Error("QR callback was not captured");

    // A -> B -> A while the first fetch is still in flight.
    rerender(
      <TypeStep
        groupMembers={[]}
        accountId="account-2"
        participants={[]}
        occurredOn="2026-09-10"
        onReviewingChange={() => {}}
        onTypeSelect={onTypeSelect}
        onScanConfirm={onScanConfirm}
        onVoiceConfirm={onVoiceConfirm}
      />,
    );
    rerender(
      <TypeStep
        groupMembers={[]}
        accountId="account-1"
        participants={[]}
        occurredOn="2026-09-10"
        onReviewingChange={() => {}}
        onTypeSelect={onTypeSelect}
        onScanConfirm={onScanConfirm}
        onVoiceConfirm={onVoiceConfirm}
      />,
    );

    resolveFetch(receipt);
    await waitFor(() => expect(fetchSefazReceipt).toHaveBeenCalledTimes(1));

    // The destroyed scanner's queued callback fires only after the round trip.
    await staleQrDetected({
      chaveAcesso: ACCESS_KEY,
      url: "https://nfce.sefaz.example/?chNFe=" + ACCESS_KEY,
    });

    expect(fetchSefazReceipt).toHaveBeenCalledTimes(1);
    expect(onScanConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Continuar para divisão/ })).not.toBeInTheDocument();

    // A fresh attempt in the restored account still reaches review.
    fetchSefazReceipt.mockResolvedValueOnce(receipt);
    await openScanner(user);
    await user.click(screen.getByRole("button", { name: "Simular QR" }));
    await user.click(await screen.findByRole("button", { name: /Continuar para divisão/ }));

    expect(fetchSefazReceipt).toHaveBeenCalledTimes(2);
    expect(onScanConfirm).toHaveBeenCalledTimes(1);
  });

  it("recovers from a failed QR fetch and lets the next attempt confirm", async () => {
    const user = userEvent.setup();
    fetchSefazReceipt.mockRejectedValueOnce(new Error("falha na consulta"));
    fetchSefazReceipt.mockResolvedValueOnce(receipt);
    const onScanConfirm = renderTypeStep();

    await openScanner(user);
    await user.click(screen.getByRole("button", { name: "Simular QR" }));
    await screen.findByText("falha na consulta");

    await user.click(screen.getByRole("button", { name: "Simular QR" }));
    await user.click(await screen.findByRole("button", { name: /Continuar para divisão/ }));

    expect(fetchSefazReceipt).toHaveBeenCalledTimes(2);
    expect(onScanConfirm).toHaveBeenCalledTimes(1);
    expect(onScanConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: "Bar do Zé" }),
      ACCESS_KEY,
      expect.anything(),
      expect.any(String),
    );
  });
});
