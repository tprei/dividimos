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
import { processReceiptScan } from "@/lib/process-receipt-scan";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import type { ItemDivisionValue } from "@/lib/item-division";
import type { ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import type { ExpenseType, UserProfile } from "@/types";

export interface TypeStepProps {
  groupMembers: UserProfile[];
  participants: ItemDivisionParticipant[];
  occurredOn: string;
  onTypeSelect: (type: ExpenseType) => void;
  onScanConfirm: (
    result: ReceiptOcrResult,
    receiptAccessKey: string | null,
    divisions: Record<number, ItemDivisionValue>,
    occurredOn: string,
  ) => void;
  onVoiceConfirm: (result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => void;
  onReviewingChange: (reviewing: boolean) => void;
  onManageParticipants: () => void;
}

export function TypeStep({
  groupMembers,
  occurredOn,
  participants,
  onTypeSelect,
  onScanConfirm,
  onVoiceConfirm,
  onReviewingChange,
  onManageParticipants,
}: TypeStepProps) {
  const searchParams = useSearchParams();

  const [showScanner, setShowScanner] = useState(false);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [scanProcessingPhoto, setScanProcessingPhoto] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ReceiptOcrResult | null>(null);
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceExpenseResult | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const scanParamRef = useRef(false);
  useEffect(() => {
    if (scanParamRef.current) return;
    if (searchParams.get("scan") && !showScanner && !scanResult) {
      scanParamRef.current = true;
      setShowScanner(true);
    }
  }, [searchParams, showScanner, scanResult]);

  const reviewing = scanResult !== null;
  useEffect(() => {
    onReviewingChange(reviewing);
    return () => onReviewingChange(false);
  }, [reviewing, onReviewingChange]);

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


  const handleScanConfirm = useCallback((result: ReceiptOcrResult, occurredOn: string) => {
    setScanResult(null);
    onScanConfirm(result, null, {}, occurredOn);
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
        participants={participants}
        initialOccurredOn={occurredOn}
        onConfirm={handleScanConfirm}
        onCancel={handleScanCancel}
        onManageParticipants={onManageParticipants}
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
          onProcess={handleScanProcess}
          onBack={() => {
            setShowScanner(false);
            setScanError(null);
          }}
          processing={scanProcessing}
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
