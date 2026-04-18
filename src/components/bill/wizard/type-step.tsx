"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BillTypeSelector } from "@/components/bill/bill-type-selector";
import { ReceiptScanner } from "@/components/bill/receipt-scanner";
import { ScanSkeletonLoader } from "@/components/bill/scan-skeleton-loader";
import { ScannedItemsReview } from "@/components/bill/scanned-items-review";
import { VoiceExpenseButton } from "@/components/bill/voice-expense-button";
import { VoiceExpenseModal, type ResolvedParticipant } from "@/components/bill/voice-expense-modal";
import { Button } from "@/components/ui/button";
import { useQrScannerPreload } from "@/hooks/use-qr-preload";
import { processReceiptScan, fetchSefazReceipt, SefazFallbackError } from "@/lib/process-receipt-scan";
import type { NfceQrResult } from "@/lib/nfce-qr";
import { checkDuplicateReceipt, markReceiptScanned } from "@/lib/nfce-dedup";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import type { ExpenseType, UserProfile } from "@/types";

export interface TypeStepProps {
  groupMembers: UserProfile[];
  onTypeSelect: (type: ExpenseType) => void;
  onScanConfirm: (result: ReceiptOcrResult, chaveAcesso: string | null) => void;
  onVoiceConfirm: (result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => void;
}

export function TypeStep({
  groupMembers,
  onTypeSelect,
  onScanConfirm,
  onVoiceConfirm,
}: TypeStepProps) {
  const searchParams = useSearchParams();

  useQrScannerPreload();

  const [showScanner, setShowScanner] = useState(false);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [scanProcessingPhoto, setScanProcessingPhoto] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ReceiptOcrResult | null>(null);
  const [sefazFallback, setSefazFallback] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const lastQrResultRef = useRef<NfceQrResult | null>(null);
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceExpenseResult | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const scanParamRef = useRef(false);
  useEffect(() => {
    if (scanParamRef.current) return;
    if (searchParams.get("scan") && !showScanner && !scanResult) {
      scanParamRef.current = true;
      onTypeSelect("itemized");
      setShowScanner(true);
    }
  }, [searchParams, showScanner, scanResult, onTypeSelect]);

  const handleScanProcess = useCallback(async (file: File) => {
    setScanProcessing(true);
    setScanProcessingPhoto(true);
    setScanError(null);
    try {
      const result: ReceiptOcrResult = await processReceiptScan(file);
      setScanResult(result);
      setShowScanner(false);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Erro ao processar imagem");
    } finally {
      setScanProcessing(false);
      setScanProcessingPhoto(false);
    }
  }, []);

  const handleQrDetected = useCallback(async (result: NfceQrResult) => {
    setScanError(null);
    setDuplicateWarning(null);
    setScanProcessing(true);
    lastQrResultRef.current = result;

    const previousScan = checkDuplicateReceipt(result.chaveAcesso);
    if (previousScan) {
      const date = new Date(previousScan);
      const formatted = date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      setDuplicateWarning(
        `Esta nota já foi escaneada em ${formatted}. Deseja continuar mesmo assim?`,
      );
      setScanProcessing(false);
      return;
    }

    try {
      const receipt = await fetchSefazReceipt(result.url);
      setScanResult(receipt);
      setShowScanner(false);
    } catch (err) {
      if (err instanceof SefazFallbackError) {
        setScanError("Não foi possível ler a nota online. Tente capturar a foto.");
        setSefazFallback(true);
        setShowScanner(true);
      } else {
        setScanError(err instanceof Error ? err.message : "Erro ao consultar SEFAZ");
      }
    } finally {
      setScanProcessing(false);
    }
  }, []);

  const handleDuplicateContinue = useCallback(async () => {
    const qrResult = lastQrResultRef.current;
    if (!qrResult) return;
    setDuplicateWarning(null);
    setScanProcessing(true);
    try {
      const receipt = await fetchSefazReceipt(qrResult.url);
      setScanResult(receipt);
      setShowScanner(false);
    } catch (err) {
      if (err instanceof SefazFallbackError) {
        setScanError("Não foi possível ler a nota online. Tente capturar a foto.");
        setSefazFallback(true);
        setShowScanner(true);
      } else {
        setScanError(err instanceof Error ? err.message : "Erro ao consultar SEFAZ");
      }
    } finally {
      setScanProcessing(false);
    }
  }, []);

  const handleScanConfirm = useCallback((result: ReceiptOcrResult) => {
    const chaveAcesso = lastQrResultRef.current?.chaveAcesso ?? null;
    if (chaveAcesso) {
      markReceiptScanned(chaveAcesso);
      lastQrResultRef.current = null;
    }
    setScanResult(null);
    setDuplicateWarning(null);
    onScanConfirm(result, chaveAcesso);
  }, [onScanConfirm]);

  const handleScanCancel = useCallback(() => {
    setScanResult(null);
  }, []);

  const handleVoiceResult = useCallback((result: VoiceExpenseResult) => {
    setVoiceResult(result);
    setShowVoiceInput(false);
    setVoiceError(null);
  }, []);

  const handleVoiceError = useCallback((message: string) => {
    setVoiceError(message);
  }, []);

  const handleVoiceCancel = useCallback(() => {
    setVoiceResult(null);
  }, []);

  if (scanResult) {
    return (
      <ScannedItemsReview
        result={scanResult}
        onConfirm={handleScanConfirm}
        onCancel={handleScanCancel}
      />
    );
  }

  if (scanProcessingPhoto) {
    return <ScanSkeletonLoader />;
  }

  if (showScanner) {
    return (
      <div className="space-y-3">
        <ReceiptScanner
          key={sefazFallback ? "fallback" : "default"}
          onProcess={handleScanProcess}
          onBack={() => { setShowScanner(false); setScanError(null); setSefazFallback(false); }}
          processing={scanProcessing}
          onQrDetected={handleQrDetected}
        />
        {scanError && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-sm text-destructive"
          >
            {scanError}
          </motion.p>
        )}
        {duplicateWarning && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-center dark:border-yellow-700 dark:bg-yellow-950"
          >
            <p className="mb-2 text-sm text-yellow-800 dark:text-yellow-200">
              {duplicateWarning}
            </p>
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setDuplicateWarning(null); lastQrResultRef.current = null; }}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleDuplicateContinue}
              >
                Continuar mesmo assim
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  if (voiceResult) {
    return (
      <VoiceExpenseModal
        result={voiceResult}
        groupMembers={groupMembers}
        onConfirm={onVoiceConfirm}
        onCancel={handleVoiceCancel}
      />
    );
  }

  if (showVoiceInput) {
    return (
      <div className="space-y-3">
        <VoiceExpenseButton
          members={groupMembers.map((m) => ({ handle: m.handle, name: m.name }))}
          onResult={handleVoiceResult}
          onError={handleVoiceError}
        />
        {voiceError && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-sm text-destructive"
          >
            {voiceError}
          </motion.p>
        )}
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => { setShowVoiceInput(false); setVoiceError(null); }}
        >
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <BillTypeSelector
      onSelect={onTypeSelect}
      onScanReceipt={() => setShowScanner(true)}
      onVoiceExpense={() => setShowVoiceInput(true)}
    />
  );
}
